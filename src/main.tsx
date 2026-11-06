import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { isTauri } from './lib/tauri'
import { getCurrentWindow } from '@tauri-apps/api/window'

/** 悬浮单词卡片是本应用的第二个窗口，按 label 走独立入口 */
const isVocabOrb = isTauri() && getCurrentWindow().label === 'vocab-orb'

// 悬浮窗口是透明窗口，首帧前就把 body 背景去掉，避免闪一下方形底色
if (isVocabOrb) document.body.classList.add('vg-orb-body')

const root = createRoot(document.getElementById('root')!)

// 必须用动态导入分流：静态导入 App 会让悬浮窗顺带执行 task-store 的模块级初始化
// （加载任务库、启动云盘自动同步），两个窗口同时读写同一份数据库与云盘文件会卡死。
if (isVocabOrb) {
  void import('./components/VocabOrbWindow.tsx').then(({ VocabOrbWindow }) => {
    root.render(
      <StrictMode>
        <VocabOrbWindow />
      </StrictMode>,
    )
  })
} else {
  void import('./App.tsx').then(({ default: App }) => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
}
