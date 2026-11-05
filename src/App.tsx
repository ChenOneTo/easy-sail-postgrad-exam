import { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { CalendarView } from './components/CalendarView';
import { KanbanBoard } from './components/KanbanBoard';
import { AiAssistant } from './components/AiAssistant';
import { DetailPanel } from './components/DetailPanel';
import { QuickAdd } from './components/QuickAdd';
import { SettingsModal } from './components/SettingsModal';
import { SplashScreen } from './components/SplashScreen';
import { UpdatePrompt } from './components/UpdatePrompt';
import { NotificationCenter } from './components/NotificationCenter';
import { ExamPlanPage } from './components/ExamPlanPage';
import { ExamVocabPage } from './components/ExamVocabPage';
import { VocabGamePage } from './components/VocabGamePage';
import { ExamReadingPage } from './components/ExamReadingPage';
import { ExamClozePage } from './components/ExamClozePage';
import { MgmtPracticePage } from './components/MgmtPracticePage';
import { ExamPrefsPage } from './components/ExamPrefsPage';
import { TypingVocabPage } from './components/TypingVocabPage';
import { useTaskStore } from './stores/task-store';
import { useVocabGameStore } from './stores/vocab-game-store';
import { shouldShowSplashOnLaunch } from './lib/splash';
import { isTauri } from './lib/tauri';
import { takeSessionForMain, VOCAB_ORB_RETURN_EVENT } from './lib/vocab-orb-bridge';

export default function App() {
  const { currentView, currentSection, detailTaskId, theme, closeDetail } = useTaskStore();
  const isSpecialSection = currentSection === 'exam' || currentSection === 'exam-vocab'
    || currentSection === 'exam-vocab-game' || currentSection === 'exam-reading'
    || currentSection === 'exam-cloze'
    || currentSection === 'exam-prefs'
    || currentSection === 'exam-mgmt-math' || currentSection === 'exam-mgmt-logic'
    || currentSection === 'typing-vocab';
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [showSplash, setShowSplash] = useState(
    () => shouldShowSplashOnLaunch()
  );

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { closeDetail(); setSettingsOpen(false); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') { e.preventDefault(); document.querySelector<HTMLInputElement>('.quick-add-input')?.focus(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [closeDetail]);

  // 悬浮单词卡片关闭时会把未完成的会话交还主窗口，直接回到闯关界面继续
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listen(VOCAB_ORB_RETURN_EVENT, () => {
      const session = takeSessionForMain();
      if (session) {
        useVocabGameStore.setState({ session });
        useTaskStore.getState().setSection('exam-vocab-game');
        return;
      }
      // 悬浮卡片里已结束本关：刷新概览，避免学习台的数字滞后
      void useVocabGameStore.getState().refresh();
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  if (currentView === 'ai') {
    return (
      <>
        {showSplash && <SplashScreen onEnter={() => setShowSplash(false)} />}
        <div className="app">
          <Sidebar onOpenSettings={() => setSettingsOpen(true)} onOpenNotifications={() => setNotificationsOpen(true)} />
          <div className="main-wrap">
            <TopBar onOpenNotifications={() => setNotificationsOpen(true)} />
            <AiAssistant />
          </div>
          <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
          <NotificationCenter open={notificationsOpen} onClose={() => setNotificationsOpen(false)} />
          <UpdatePrompt />
        </div>
      </>
    );
  }

  return (
    <>
      {showSplash && <SplashScreen onEnter={() => setShowSplash(false)} />}
      <div className="app">
        <Sidebar onOpenSettings={() => setSettingsOpen(true)} onOpenNotifications={() => setNotificationsOpen(true)} />
        <div className="main-wrap">
          <TopBar onOpenNotifications={() => setNotificationsOpen(true)} />
          <div className="content">
            <div className="view-area">
              {currentSection === 'exam' && <ExamPlanPage />}
              {currentSection === 'exam-vocab' && <ExamVocabPage />}
              {currentSection === 'exam-vocab-game' && <VocabGamePage />}
              {currentSection === 'exam-reading' && <ExamReadingPage />}
              {currentSection === 'exam-cloze' && <ExamClozePage />}
              {currentSection === 'exam-prefs' && <ExamPrefsPage />}
              {currentSection === 'exam-mgmt-math' && <MgmtPracticePage subject="math" />}
              {currentSection === 'exam-mgmt-logic' && <MgmtPracticePage subject="logic" />}
              {currentSection === 'typing-vocab' && <TypingVocabPage />}
              {!isSpecialSection && currentView === 'calendar' && <CalendarView />}
              {!isSpecialSection && currentView === 'kanban' && <KanbanBoard />}
            </div>
          </div>
          {!isSpecialSection && <QuickAdd />}
        </div>
        {detailTaskId && <DetailPanel />}
        <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        <NotificationCenter open={notificationsOpen} onClose={() => setNotificationsOpen(false)} />
        <UpdatePrompt />
      </div>
    </>
  );
}
