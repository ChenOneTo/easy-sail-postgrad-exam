import { useState, useEffect } from 'react';
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
import { useTaskStore } from './stores/task-store';
import { shouldShowSplashOnLaunch } from './lib/splash';

export default function App() {
  const { currentView, currentSection, detailTaskId, theme, closeDetail } = useTaskStore();
  const isSpecialSection = currentSection === 'exam' || currentSection === 'exam-vocab' || currentSection === 'exam-vocab-game' || currentSection === 'exam-reading';
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
