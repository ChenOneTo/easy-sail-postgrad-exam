import { Sparkles } from 'lucide-react';
import { canUseAi } from '../lib/ai';

interface AiButtonProps {
  children: React.ReactNode;
  loading?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}

export function AiButton({ children, loading, disabled, title, onClick }: AiButtonProps) {
  const available = canUseAi();
  const isDisabled = disabled || loading || !available;

  return (
    <button
      className="ai-action-btn"
      disabled={isDisabled}
      title={available ? title : '在设置中开启并配置 AI 功能'}
      onClick={onClick}
    >
      <Sparkles size={13} />
      <span>{loading ? '处理中...' : children}</span>
    </button>
  );
}
