import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { VocabOrbWindow } from './components/VocabOrbWindow.tsx'
import { isTauri } from './lib/tauri'
import { getCurrentWindow } from '@tauri-apps/api/window'

/** 悬浮单词卡片是本应用的第二个窗口，按 label 走独立入口，不渲染主界面 */
const isVocabOrb = isTauri() && getCurrentWindow().label === 'vocab-orb'

// 悬浮窗口是透明窗口，首帧前就把 body 背景去掉，避免闪一下方形底色
if (isVocabOrb) document.body.classList.add('vg-orb-body')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isVocabOrb ? <VocabOrbWindow /> : <App />}
  </StrictMode>,
)
