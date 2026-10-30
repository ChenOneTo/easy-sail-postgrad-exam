import { Briefcase, BookOpen, House } from 'lucide-react';

/**
 * 任务类型图标
 *
 * 独立成组件而非导出一个 JSX 映射表，避免组件文件导出非组件成员
 * （react-refresh/only-export-components 规则）。
 */
export function TaskTypeIcon({ typeId, size = 11 }: { typeId: string; size?: number }) {
  switch (typeId) {
    case 'project-work': return <Briefcase size={size} />;
    case 'project-study': return <BookOpen size={size} />;
    case 'project-life': return <House size={size} />;
    default: return null;
  }
}
