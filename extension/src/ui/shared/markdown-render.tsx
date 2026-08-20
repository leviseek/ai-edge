/** 自研轻量 Markdown 渲染器（基于 markdown.ts tokenizer 的 React 视图） */
import { Fragment, type ReactNode } from 'react';
import { tokenizeMarkdown, type Inline, type MdBlock } from './markdown';

function renderInline(inl: Inline[], keyBase: string): ReactNode[] {
  return inl.map((t, i) => {
    const key = `${keyBase}-${i}`;
    switch (t.t) {
      case 'bold':
        return <strong key={key}>{renderInline(t.c, key)}</strong>;
      case 'italic':
        return <em key={key}>{renderInline(t.c, key)}</em>;
      case 'code':
        return <code key={key}>{t.v}</code>;
      case 'link':
        return (
          <a key={key} href={t.href} target="_blank" rel="noreferrer">
            {t.v}
          </a>
        );
      default:
        return <Fragment key={key}>{t.v}</Fragment>;
    }
  });
}

const HEADING_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;

function renderBlock(b: MdBlock, key: number): ReactNode {
  switch (b.t) {
    case 'heading': {
      const Tag = HEADING_TAGS[Math.min(6, b.level) - 1] ?? 'h6';
      return <Tag key={key}>{renderInline(b.inline, `h${key}`)}</Tag>;
    }
    case 'paragraph':
      return <p key={key}>{renderInline(b.inline, `p${key}`)}</p>;
    case 'ul':
      return (
        <ul key={key}>
          {b.items.map((it, i) => (
            <li key={i}>{renderInline(it, `li${key}-${i}`)}</li>
          ))}
        </ul>
      );
    case 'ol':
      return (
        <ol key={key}>
          {b.items.map((it, i) => (
            <li key={i}>{renderInline(it, `li${key}-${i}`)}</li>
          ))}
        </ol>
      );
    case 'quote':
      return <blockquote key={key}>{b.blocks.map((bb, i) => renderBlock(bb, key * 100 + i))}</blockquote>;
    case 'code':
      return (
        <pre key={key}>
          <code>{b.text}</code>
        </pre>
      );
    case 'hr':
      return <hr key={key} />;
    default:
      return null;
  }
}

export function renderMarkdown(src: string): ReactNode[] {
  return tokenizeMarkdown(src).map((b, i) => renderBlock(b, i));
}