type JsonObject = Record<string, any>;

export type AppServerEvent = {
  method: string;
  params: JsonObject;
  receivedAt: string;
};

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
};

export class CodexAppServer {
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private writer: any = null;
  private nextId = 1;
  private pending = new Map<number | string, PendingRequest>();
  private listeners = new Set<(event: AppServerEvent) => void>();
  private serverRequests = new Map<number | string, JsonObject>();
  private initialized = false;
  private stderr = "";

  onEvent(listener: (event: AppServerEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(cwd = process.cwd()) {
    if (this.proc && this.initialized) return;

    this.proc = Bun.spawn(["codex", "app-server", "--stdio"], {
      cwd,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });
    this.writer = this.proc.stdin;
    void this.readStdout(this.proc.stdout);
    void this.readStderr(this.proc.stderr);

    await this.request("initialize", {
      clientInfo: {
        name: "cu_test",
        title: "CU Test",
        version: "0.3.0",
      },
    });
    this.notify("initialized", {});
    this.initialized = true;
  }

  private async readStdout(stream: ReadableStream<Uint8Array>) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) this.handleMessage(JSON.parse(line));
        newline = buffer.indexOf("\n");
      }
    }
    const error = new Error(`Codex App Server exited.${this.stderr ? ` ${this.stderr.trim()}` : ""}`);
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.initialized = false;
  }

  private async readStderr(stream: ReadableStream<Uint8Array>) {
    this.stderr = await new Response(stream).text();
  }

  private handleMessage(message: JsonObject) {
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else pending.resolve(message.result);
      return;
    }

    if (message.id !== undefined && message.method) {
      this.serverRequests.set(message.id, message);
      this.emit({
        method: "bridge/approvalRequested",
        params: { requestId: message.id, method: message.method, request: message.params || {} },
        receivedAt: new Date().toISOString(),
      });
      return;
    }

    if (message.method) {
      this.emit({
        method: message.method,
        params: message.params || {},
        receivedAt: new Date().toISOString(),
      });
    }
  }

  private emit(event: AppServerEvent) {
    for (const listener of this.listeners) listener(event);
  }

  private send(message: JsonObject) {
    if (!this.writer) throw new Error("Codex App Server is not running.");
    this.writer.write(`${JSON.stringify(message)}\n`);
  }

  request(method: string, params?: JsonObject): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send(params === undefined ? { method, id } : { method, id, params });
    });
  }

  notify(method: string, params: JsonObject) {
    this.send({ method, params });
  }

  async status(cwd = process.cwd()) {
    await this.start(cwd);
    const [account, models] = await Promise.all([
      this.request("account/read", { refreshToken: false }),
      this.request("model/list", { limit: 1 }),
    ]);
    return {
      connected: true,
      authenticated: Boolean(account?.account) || account?.requiresOpenaiAuth === false,
      accountType: account?.account?.type || null,
      model: models?.data?.[0]?.model || models?.models?.[0]?.model || null,
    };
  }

  async startTurn(prompt: string, options: { cwd?: string; model?: string } = {}) {
    const cwd = options.cwd || process.cwd();
    await this.start(cwd);
    const thread = await this.request("thread/start", {
      cwd,
      approvalPolicy: "on-request",
      ...(options.model ? { model: options.model } : {}),
    });
    const threadId = thread?.thread?.id;
    if (!threadId) throw new Error("Codex did not return a thread id.");
    const turn = await this.request("turn/start", {
      threadId,
      input: [{ type: "text", text: prompt }],
    });
    return { threadId, turnId: turn?.turn?.id || null };
  }

  async interrupt(threadId: string, turnId: string) {
    return this.request("turn/interrupt", { threadId, turnId });
  }

  listApprovals() {
    return [...this.serverRequests.entries()].map(([id, message]) => ({
      id,
      method: message.method,
      params: message.params || {},
    }));
  }

  answerApproval(id: number | string, action: "approve" | "deny", session = false) {
    const request = this.serverRequests.get(id);
    if (!request) throw new Error("Approval request is no longer pending.");
    const method = request.method;
    let result: JsonObject;

    if (method === "item/commandExecution/requestApproval") {
      result = { decision: action === "approve" ? (session ? "acceptForSession" : "accept") : "decline" };
    } else if (method === "item/fileChange/requestApproval") {
      result = { decision: action === "approve" ? (session ? "acceptForSession" : "accept") : "decline" };
    } else if (method === "item/permissions/requestApproval") {
      if (action === "approve") {
        const requested = request.params?.permissions || {};
        result = {
          permissions: Object.fromEntries(Object.entries(requested).filter(([, value]) => value != null)),
          scope: session ? "session" : "turn",
        };
      } else {
        result = { permissions: {}, scope: "turn", strictAutoReview: true };
      }
    } else if (method === "execCommandApproval" || method === "applyPatchApproval") {
      result = { decision: action === "approve" ? (session ? "approved_for_session" : "approved") : { denied: { rejection: "Denied in CU Test" } } };
    } else {
      if (action === "approve") throw new Error(`CU Test cannot safely approve ${method} yet. Open the task in Codex to answer it.`);
      result = { decision: "decline" };
    }

    this.send({ id, result });
    this.serverRequests.delete(id);
  }

  close() {
    try {
      this.writer?.end();
    } catch {
      // Process may already be gone.
    }
    this.proc?.kill();
    this.proc = null;
    this.initialized = false;
  }
}
