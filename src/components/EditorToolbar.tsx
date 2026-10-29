import { useRef } from 'react';

interface EditorToolbarProps {
  onInsert: (before: string, after?: string) => void;
  onInsertImage: () => void;
  onCopy: () => void;
  copied: boolean;
}

export function EditorToolbar({ onInsert, onInsertImage, onCopy, copied }: EditorToolbarProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="editor-toolbar">
      <button className="toolbar-btn" onClick={() => onInsert('## ', '')} title="标题">H</button>
      <button className="toolbar-btn" onClick={() => onInsert('**', '**')} title="加粗"><b>B</b></button>
      <button className="toolbar-btn" onClick={() => onInsert('*', '*')} title="斜体"><i>I</i></button>
      <button className="toolbar-btn" onClick={() => onInsert('> ', '')} title="引用">"</button>
      <button className="toolbar-btn" onClick={() => onInsert('- ', '')} title="无序列表">•</button>
      <button className="toolbar-btn" onClick={() => onInsert('1. ', '')} title="有序列表">1.</button>
      <button className="toolbar-btn" onClick={() => onInsert('```ts\n', '\n```')} title="代码块">&lt;/&gt;</button>
      <button className="toolbar-btn" onClick={() => onInsert('---\n', '')} title="分割线">―</button>
      <button className="toolbar-btn" onClick={onInsertImage} title="插入图片">📷</button>
      <div className="toolbar-spacer" />
      <button className="toolbar-btn primary" onClick={onCopy}>
        {copied ? '✓ 已复制' : '复制到公众号'}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            onInsert(`\n![${file.name}](${dataUrl})\n`);
          };
          reader.readAsDataURL(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}
