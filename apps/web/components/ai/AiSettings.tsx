"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Settings2, X } from "lucide-react";

type ProviderKind = "mock" | "openai" | "anthropic";

type PublicConfig = {
  provider: ProviderKind;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  source: "user" | "env" | "default";
};

const PRESETS: Record<
  Exclude<ProviderKind, "mock">,
  { label: string; baseUrl: string; model: string; hint: string }
> = {
  openai: {
    label: "OpenAI / 兼容",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    hint: "支持任意 OpenAI 兼容端点（DeepSeek、Moonshot、OpenRouter、自建网关等），Base URL 填到 /v1",
  },
  anthropic: {
    label: "Anthropic",
    baseUrl: "https://api.anthropic.com",
    model: "claude-sonnet-4-5",
    hint: "Messages API。自定义网关填完整前缀（不要带 /v1/messages）",
  },
};

export function AiSettings() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [provider, setProvider] = useState<ProviderKind>("mock");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/ai/config");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      const c = data.config as PublicConfig;
      setConfig(c);
      setProvider(c.provider);
      setBaseUrl(c.baseUrl);
      setModel(c.model);
      setApiKey(""); // never prefill
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const applyPreset = (kind: Exclude<ProviderKind, "mock">) => {
    setProvider(kind);
    setBaseUrl(PRESETS[kind].baseUrl);
    setModel(PRESETS[kind].model);
  };

  const save = async () => {
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch("/api/ai/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          baseUrl: baseUrl || undefined,
          model: model || undefined,
          apiKey: apiKey || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setConfig(data.config);
      setApiKey("");
      setMsg("已保存");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch("/api/ai/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          baseUrl: baseUrl || undefined,
          model: model || undefined,
          apiKey: apiKey || undefined,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Connection failed");
      setMsg(
        data.provider === "mock"
          ? "Mock 可用"
          : `连接成功${data.preview ? `：${data.preview}` : ""}`,
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Connection failed");
    } finally {
      setTesting(false);
    }
  };

  const clear = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/ai/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "mock", clearKey: true }),
      });
      const data = await res.json();
      if (res.ok) {
        setConfig(data.config);
        setProvider("mock");
        setBaseUrl("");
        setModel("");
        setMsg("已恢复环境变量 / mock");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded p-1 text-muted hover:bg-elevated hover:text-ink"
        title="模型设置"
      >
        <Settings2 size={13} />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-surface shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">AI 模型设置</h2>
                <p className="text-2xs text-muted">
                  密钥仅保存在服务端，不会下发到浏览器
                </p>
              </div>
              <button onClick={() => setOpen(false)} className="text-muted hover:text-ink">
                <X size={16} />
              </button>
            </div>

            <div className="space-y-4 px-4 py-4">
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-muted">
                  <Loader2 size={14} className="animate-spin" /> 加载中…
                </div>
              ) : (
                <>
                  <div>
                    <label className="mb-1.5 block text-2xs font-medium text-muted">
                      Provider
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          ["mock", "Mock"],
                          ["openai", "OpenAI 兼容"],
                          ["anthropic", "Anthropic"],
                        ] as const
                      ).map(([k, label]) => (
                        <button
                          key={k}
                          onClick={() => {
                            setProvider(k);
                            if (k !== "mock") applyPreset(k);
                          }}
                          className={`rounded-md border px-2 py-2 text-xs ${
                            provider === k
                              ? "border-accent bg-accent-soft text-accent"
                              : "border-border hover:border-accent/50"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {provider !== "mock" && (
                    <>
                      <div className="flex flex-wrap gap-1">
                        {provider === "openai" &&
                          (
                            [
                              ["OpenAI", "https://api.openai.com/v1", "gpt-4o-mini"],
                              ["DeepSeek", "https://api.deepseek.com/v1", "deepseek-chat"],
                              ["Moonshot", "https://api.moonshot.cn/v1", "moonshot-v1-8k"],
                              ["OpenRouter", "https://openrouter.ai/api/v1", "openai/gpt-4o-mini"],
                            ] as const
                          ).map(([n, u, m]) => (
                            <button
                              key={n}
                              onClick={() => {
                                setBaseUrl(u);
                                setModel(m);
                              }}
                              className="rounded-full border border-border px-2 py-0.5 text-2xs text-muted hover:border-accent hover:text-accent"
                            >
                              {n}
                            </button>
                          ))}
                        {provider === "anthropic" && (
                          <>
                            <button
                              onClick={() => {
                                setBaseUrl("https://api.anthropic.com");
                                setModel("claude-sonnet-4-5");
                              }}
                              className="rounded-full border border-border px-2 py-0.5 text-2xs text-muted hover:border-accent hover:text-accent"
                            >
                              官方 API
                            </button>
                            <button
                              onClick={() => {
                                setBaseUrl("https://api.anthropic.com");
                                setModel("claude-haiku-4-5");
                              }}
                              className="rounded-full border border-border px-2 py-0.5 text-2xs text-muted hover:border-accent hover:text-accent"
                            >
                              Haiku
                            </button>
                          </>
                        )}
                      </div>

                      <div>
                        <label className="mb-1 block text-2xs font-medium text-muted">
                          Base URL
                        </label>
                        <input
                          value={baseUrl}
                          onChange={(e) => setBaseUrl(e.target.value)}
                          placeholder={PRESETS[provider].baseUrl}
                          className="w-full rounded-md border border-border bg-bg px-2.5 py-1.5 font-mono text-xs outline-none focus:border-accent"
                        />
                        <p className="mt-1 text-2xs text-muted">{PRESETS[provider].hint}</p>
                      </div>

                      <div>
                        <label className="mb-1 block text-2xs font-medium text-muted">
                          Model
                        </label>
                        <input
                          value={model}
                          onChange={(e) => setModel(e.target.value)}
                          placeholder={PRESETS[provider].model}
                          className="w-full rounded-md border border-border bg-bg px-2.5 py-1.5 font-mono text-xs outline-none focus:border-accent"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-2xs font-medium text-muted">
                          API Key
                          {config?.hasApiKey && (
                            <span className="ml-1 text-success">已配置（留空则保留）</span>
                          )}
                        </label>
                        <input
                          type="password"
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                          placeholder={config?.hasApiKey ? "••••••••（保持不变）" : "sk-..."}
                          autoComplete="off"
                          className="w-full rounded-md border border-border bg-bg px-2.5 py-1.5 font-mono text-xs outline-none focus:border-accent"
                        />
                      </div>
                    </>
                  )}

                  {config && (
                    <p className="text-2xs text-muted">
                      当前来源：{config.source === "user" ? "用户配置" : "环境变量"}
                      {config.hasApiKey ? " · 有 Key" : " · 无 Key"}
                    </p>
                  )}

                  {err && (
                    <p className="rounded-md bg-danger/10 px-2 py-1.5 text-xs text-danger">
                      {err}
                    </p>
                  )}
                  {msg && (
                    <p className="rounded-md bg-success/10 px-2 py-1.5 text-xs text-success">
                      {msg}
                    </p>
                  )}
                </>
              )}
            </div>

            <div className="flex items-center gap-2 border-t border-border px-4 py-3">
              <button
                onClick={save}
                disabled={saving || loading}
                className="flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                保存
              </button>
              {provider !== "mock" && (
                <button
                  onClick={test}
                  disabled={testing}
                  className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-accent disabled:opacity-50"
                >
                  {testing ? "测试中…" : "测试连接"}
                </button>
              )}
              <button
                onClick={clear}
                disabled={saving}
                className="ml-auto text-2xs text-muted hover:text-danger"
              >
                清除用户配置
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
