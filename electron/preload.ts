import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'

contextBridge.exposeInMainWorld('yami', {
  readClipboardImage: () => ipcRenderer.invoke('clipboard:read-image'),
  readImageFiles: (paths: string[]) => ipcRenderer.invoke('files:read-images', paths),
  openImages: () => ipcRenderer.invoke('dialog:open-images'),
  saveProjectFile: (project: unknown) => ipcRenderer.invoke('project:save', project),
  openProjectFile: () => ipcRenderer.invoke('project:open'),
  readProjectFile: (path: string) => ipcRenderer.invoke('project:read', path),
  rendererReady: () => ipcRenderer.send('renderer:ready'),
  closeWindowNow: () => ipcRenderer.invoke('window:close-now'),
  toggleFullscreen: () => ipcRenderer.invoke('window:toggle-fullscreen'),
  showMainWindow: () => ipcRenderer.invoke('window:show-main'),
  onScreenshotCaptured: (callback: (image: { dataUrl: string; width: number; height: number; name?: string }) => void) => {
    const listener = (_event: IpcRendererEvent, image: { dataUrl: string; width: number; height: number; name?: string }) => callback(image)
    ipcRenderer.on('screenshot:captured', listener)
    return () => ipcRenderer.removeListener('screenshot:captured', listener)
  },
  onScreenshotError: (callback: (message: string) => void) => {
    const listener = (_event: IpcRendererEvent, message: string) => callback(message)
    ipcRenderer.on('screenshot:error', listener)
    return () => ipcRenderer.removeListener('screenshot:error', listener)
  },
  onScreenshotShortcutStatus: (callback: (status: { ok: boolean; message?: string }) => void) => {
    const listener = (_event: IpcRendererEvent, status: { ok: boolean; message?: string }) => callback(status)
    ipcRenderer.on('screenshot:shortcut-status', listener)
    return () => ipcRenderer.removeListener('screenshot:shortcut-status', listener)
  },
  onCloseRequest: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('window:close-requested', listener)
    return () => ipcRenderer.removeListener('window:close-requested', listener)
  },
  onMenuCommand: (callback: (command: string) => void) => {
    const listener = (_event: IpcRendererEvent, command: string) => callback(command)
    ipcRenderer.on('menu:command', listener)
    return () => ipcRenderer.removeListener('menu:command', listener)
  },
})
