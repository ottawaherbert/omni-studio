import { useLayoutEffect, useRef, useState, type TextareaHTMLAttributes } from 'react';

/** Expand ordinary story notes with their content; only very long notes fold. */
export function ScriptLongText({rows = 4, ...props}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [long, setLong] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const resize = () => {
      const minimum = Number(rows) * 24 + 24;
      element.style.height = 'auto';
      const height = Math.max(minimum, element.scrollHeight);
      setLong(height > 480);
      element.style.height = `${expanded ? height : Math.min(480, height)}px`;
      element.style.overflowY = !expanded && height > 480 ? 'auto' : 'hidden';
    };
    resize();
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth !== width) { width = element.clientWidth; resize(); }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [props.value, rows, expanded]);
  return <div className="min-w-0">
    <textarea {...props} ref={ref} rows={rows} style={{...props.style, resize: 'vertical', lineHeight: '24px'}} />
    {long && <button type="button" className="text-xs text-text-secondary underline" onClick={() => setExpanded(value => !value)}>{expanded ? '收起长文' : '展开全文'}</button>}
  </div>;
}
