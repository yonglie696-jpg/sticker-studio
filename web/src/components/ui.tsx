import { useEffect, useRef, useState, type ReactNode } from 'react';
import { charLen } from '../api';
import type { CheckIssue } from '../api';

export function PageHeader({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-3xl text-ink">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function Field({
  label,
  value,
  onChange,
  max,
  min,
  multiline,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  max?: number;
  min?: number;
  multiline?: boolean;
  placeholder?: string;
  hint?: string;
}) {
  const n = charLen(value);
  const bad = (max !== undefined && n > max) || (min !== undefined && n > 0 && n < min);
  return (
    <label className="block">
      <span className="label flex justify-between">
        <span>{label}</span>
        {max !== undefined && (
          <span className={bad ? 'font-semibold text-bad' : ''}>
            {n}/{min ? `${min}–` : ''}
            {max}
          </span>
        )}
      </span>
      {multiline ? (
        <textarea className={`input min-h-[68px] ${bad ? 'border-bad' : ''}`} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className={`input ${bad ? 'border-bad' : ''}`} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function CopyButton({ getText, label = '复制提示词' }: { getText: () => Promise<string> | string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn"
      onClick={async () => {
        const t = await getText();
        await navigator.clipboard.writeText(t);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? '已复制 ✓' : label}
    </button>
  );
}

export function DropZone({ onFile, label = '拖入文件或点击选择', accept = 'image/*', small }: { onFile: (f: File) => void; label?: string; accept?: string; small?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      className={`flex cursor-pointer items-center justify-center rounded-xl border-2 border-dashed text-center text-xs text-muted transition ${
        over ? 'border-accent bg-accent-soft' : 'border-line hover:border-accent'
      } ${small ? 'px-2 py-2' : 'px-4 py-5'}`}
      onClick={() => ref.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
    >
      {label}
      <input
        ref={ref}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}

export function Issues({ issues }: { issues: CheckIssue[] }) {
  if (!issues.length) return <p className="text-sm text-ok">全部符合微信规范 ✓</p>;
  return (
    <ul className="space-y-1">
      {issues.map((i, k) => (
        <li key={k} className="flex gap-2 text-sm">
          <span className={`chip shrink-0 ${i.level === 'error' ? 'bg-[#fde4e8] text-bad' : 'bg-[#fdf0dc] text-warn'}`}>{i.level === 'error' ? '必须改' : '建议'}</span>
          <span>
            <b className="font-medium">{i.field}</b>：{i.msg}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Badge({ ok, children }: { ok: boolean | null; children: ReactNode }) {
  const cls = ok === null ? 'bg-[#f3eae6] text-muted' : ok ? 'bg-[#e2f5ec] text-ok' : 'bg-[#fde4e8] text-bad';
  return <span className={`chip ${cls}`}>{children}</span>;
}

export function ErrorText({ msg }: { msg?: string }) {
  return msg ? <p className="mt-2 rounded-lg bg-[#fde4e8] px-3 py-2 text-sm text-bad">{msg}</p> : null;
}

/** 仿微信聊天气泡：在真实场景里看表情（浅色/深色） */
export function ChatPreview({ src, dark, size = 120, selected, onClick, label }: { src?: string; dark: boolean; size?: number; selected?: boolean; onClick?: () => void; label?: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex flex-col items-end gap-1 rounded-2xl p-3 transition ${dark ? 'bg-[#111]' : 'bg-[#ededed]'} ${
        selected ? 'ring-4 ring-accent' : 'ring-1 ring-transparent hover:ring-accent/50'
      }`}
    >
      <div className="flex items-start gap-2">
        {src ? <img src={src} width={size} height={size} alt="" className="block" style={{ imageRendering: 'auto' }} /> : <div style={{ width: size, height: size }} className="grid place-items-center text-xs text-muted">处理中…</div>}
        <div className={`h-7 w-7 shrink-0 rounded-md ${dark ? 'bg-[#3a3a3a]' : 'bg-[#cfcfcf]'}`} />
      </div>
      {label && <div className={`text-[11px] ${dark ? 'text-[#aaa]' : 'text-muted'}`}>{label}</div>}
      {selected && <span className="chip absolute top-2 left-2 bg-accent text-white">已选</span>}
    </button>
  );
}

/**
 * 两步确认按钮：第一次点变成「确定 / 取消」，再点才执行，5 秒不点自动复原。
 * 不用浏览器自带的 confirm()：有些浏览器（比如 Claude 应用自带的浏览器）会直接屏蔽它，按钮就像没反应一样。
 */
export function ConfirmButton({
  label,
  onConfirm,
  confirmLabel = '确定删除',
  className = 'btn text-bad',
  hint,
}: {
  label: ReactNode;
  onConfirm: () => unknown;
  confirmLabel?: string;
  className?: string;
  hint?: string;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);
  if (!armed)
    return (
      <button className={className} onClick={() => setArmed(true)}>
        {label}
      </button>
    );
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {hint && <span className="text-xs text-bad">{hint}</span>}
      <button
        className="rounded-lg bg-bad px-2 py-1 text-xs whitespace-nowrap text-white disabled:opacity-60"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
            setArmed(false);
          }
        }}
      >
        {busy ? '处理中…' : confirmLabel}
      </button>
      <button className="text-xs whitespace-nowrap text-muted hover:underline" onClick={() => setArmed(false)}>
        取消
      </button>
    </span>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { v: T; label: string; disabled?: boolean }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex flex-wrap rounded-xl border border-line bg-paper p-0.5">
      {options.map((o) => (
        <button
          key={o.v}
          disabled={o.disabled}
          onClick={() => onChange(o.v)}
          className={`rounded-lg px-3 py-1 text-sm whitespace-nowrap transition disabled:opacity-40 ${value === o.v ? 'bg-accent text-white' : 'text-ink hover:text-accent-dark'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
