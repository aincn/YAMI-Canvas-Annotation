import React, { useEffect, useMemo, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { Stage, Layer, Image as KonvaImage, Rect, Arrow, Text, Group, Line, Shape } from 'react-konva'
import type Konva from 'konva'
import {
  ArrowDownRight,
  Brush,
  Download,
  Eraser,
  Expand,
  Hand,
  ImagePlus,
  MousePointer2,
  Redo2,
  Settings,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'
import './styles.css'

type Tool = 'select' | 'annotate' | 'pan'
type CanvasBackgroundMode = 'grid' | 'white' | 'dark'

type AnnotationStyle = {
  arrowColor: string
  computedArrowColor?: string
  arrowWidth: number
  arrowAutoContrast: boolean
  textColor: string
  fontSize: number
  fontWeight: number
  boxBackgroundColor: string
  boxBorderColor: string
  boxBorderWidth: number
  boxBorderRadius: number
  boxPadding: number
  boxOpacity: number
}

type AppSettings = {
  defaultAnnotationStyle: AnnotationStyle
  canvasBackgroundMode: CanvasBackgroundMode
  openWindowAfterScreenshot: boolean
  showAnnotationNumbers: boolean
}

type CanvasImage = {
  id: string
  type: 'image'
  src: string
  data?: string
  name?: string
  mimeType?: string
  sourceType?: 'file' | 'drag' | 'paste' | 'clipboard' | 'project' | 'screenshot'
  zIndex?: number
  x: number
  y: number
  width: number
  height: number
  originalWidth: number
  originalHeight: number
}

type Annotation = {
  id: string
  type: 'annotation'
  sourceImageId?: string
  arrow: {
    startX: number
    startY: number
    endX: number
    endY: number
  }
  text: {
    x: number
    y: number
    content: string
    width: number
    height: number
    placement?: 'left' | 'right' | 'top' | 'bottom'
  }
  style: AnnotationStyle
}

type CanvasObject = CanvasImage | Annotation
type Viewport = { x: number; y: number; zoom: number }
type ImagePayload = { dataUrl: string; width: number; height: number; name?: string }
type UnsavedPrompt = { kind: 'import' | 'close'; resolve: (choice: 'save' | 'discard') => void } | null
type DraftArrow = { startX: number; startY: number; endX: number; endY: number; computedArrowColor?: string; sourceImageId?: string } | null
type YamiProjectFile = {
  appName: 'YAMI画布批注'
  version: 1
  createdAt: string
  updatedAt: string
  viewport: Viewport
  appSettings: AppSettings
  objects: CanvasObject[]
}
type PanGesture = { x: number; y: number; viewport: Viewport } | null
type ImageMoveGesture = { imageId: string; pointerX: number; pointerY: number; snapshot: CanvasObject[] } | null
type AnnotationMoveGesture = { annotationId: string; pointerX: number; pointerY: number; snapshot: CanvasObject[]; moved: boolean } | null
type AnnotationResizeGesture = {
  annotationId: string
  pointerX: number
  pointerY: number
  snapshot: CanvasObject[]
  text: Annotation['text']
  style: AnnotationStyle
} | null

declare global {
  interface Window {
    yami?: {
      readClipboardImage: () => Promise<ImagePayload | null>
      readImageFiles: (paths: string[]) => Promise<ImagePayload[]>
      openImages: () => Promise<ImagePayload[]>
      saveProjectFile: (project: YamiProjectFile) => Promise<{ canceled: boolean; filePath?: string }>
      openProjectFile: () => Promise<{ canceled: boolean; filePath?: string; project?: YamiProjectFile }>
      readProjectFile: (path: string) => Promise<{ canceled: boolean; filePath?: string; project?: YamiProjectFile }>
      rendererReady: () => void
      closeWindowNow: () => Promise<void>
      toggleFullscreen: () => Promise<boolean>
      showMainWindow: () => Promise<void>
      onScreenshotCaptured: (callback: (image: ImagePayload) => void) => () => void
      onScreenshotError: (callback: (message: string) => void) => () => void
      onScreenshotShortcutStatus: (callback: (status: { ok: boolean; message?: string }) => void) => () => void
      onCloseRequest: (callback: () => void) => () => void
      onMenuCommand: (callback: (command: string) => void) => () => void
    }
  }
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const uid = () => crypto.randomUUID()
const settingsStorageKey = 'yami-canvas-annotation-settings'
const formatAnnotationNumber = (index: number) => String(index)
const normalizeFontWeight = (value: unknown) => {
  if (value === 'bold') return 700
  if (value === 'normal') return 500
  return clamp(Number(value) || 500, 300, 900)
}
const getTextStrokeWidth = (fontWeight: number) => (fontWeight >= 850 ? 1.25 : fontWeight >= 750 ? 0.65 : 0)
const calloutNumberOrange = '#f06413'
const calloutNumberOrangeDark = '#a83705'
const calloutNumberOrangeLight = '#ffad38'
const getCalloutNumberMetrics = (style: AnnotationStyle) => {
  const size = Math.ceil(clamp(style.fontSize * 2.05, 26, 76))
  return {
    size,
    radius: Math.max(12, Math.min(size * 0.22, style.boxBorderRadius + 12)),
    fontSize: size * 0.7,
    fontWeight: 900,
  }
}
const getCalloutNumberSize = (style: AnnotationStyle) => getCalloutNumberMetrics(style).size
const getCalloutNumberPosition = (text: Annotation['text'], style: AnnotationStyle) => {
  const { size } = getCalloutNumberMetrics(style)
  const overlap = size * 0.45
  return {
    x: text.x - size + overlap,
    y: text.y - size + overlap,
  }
}
const getAnnotationBounds = (annotation: Annotation, withNumber: boolean) => {
  const numberMetrics = withNumber ? getCalloutNumberMetrics(annotation.style) : null
  const numberPosition = withNumber ? getCalloutNumberPosition(annotation.text, annotation.style) : null
  const numberSize = numberMetrics?.size ?? 0
  return {
    minX: Math.min(annotation.text.x, numberPosition?.x ?? annotation.text.x),
    minY: Math.min(annotation.text.y, numberPosition?.y ?? annotation.text.y),
    maxX: Math.max(annotation.text.x + annotation.text.width, numberPosition ? numberPosition.x + numberSize : annotation.text.x),
    maxY: Math.max(annotation.text.y + annotation.text.height, numberPosition ? numberPosition.y + numberSize : annotation.text.y),
  }
}
const getCalloutTextInset = (style: AnnotationStyle) => Math.ceil(getCalloutNumberMetrics(style).size * 0.45 + style.boxPadding * 0.75)
const getBracketShortcutDirection = (event: KeyboardEvent | React.KeyboardEvent) => {
  if (event.code === 'BracketRight' || event.key === ']' || event.key === '}') return 1
  if (event.code === 'BracketLeft' || event.key === '[' || event.key === '{') return -1
  return 0
}

const defaultAnnotationStyle: AnnotationStyle = {
  arrowColor: '#ff0000',
  arrowWidth: 3,
  arrowAutoContrast: true,
  textColor: '#ff0000',
  fontSize: 16,
  fontWeight: 500,
  boxBackgroundColor: '#fff3c4',
  boxBorderColor: '#ff0000',
  boxBorderWidth: 1,
  boxBorderRadius: 4,
  boxPadding: 8,
  boxOpacity: 1,
}

function scaleAnnotationStyle(style: AnnotationStyle, scale: number): AnnotationStyle {
  return {
    ...style,
    arrowWidth: clamp(style.arrowWidth * scale, 2, 10),
    fontSize: clamp(style.fontSize * scale, 12, 72),
    boxBorderWidth: clamp(style.boxBorderWidth * scale, 1, 4),
    boxBorderRadius: clamp(style.boxBorderRadius * scale, 3, 18),
    boxPadding: clamp(style.boxPadding * scale, 5, 24),
  }
}

const defaultAppSettings: AppSettings = {
  defaultAnnotationStyle,
  canvasBackgroundMode: 'grid',
  openWindowAfterScreenshot: true,
  showAnnotationNumbers: true,
}

function loadAppSettings(): AppSettings {
  try {
    const saved = localStorage.getItem(settingsStorageKey)
    if (!saved) return defaultAppSettings
    const parsed = JSON.parse(saved) as Partial<AppSettings>
    const savedStyle = parsed.defaultAnnotationStyle ?? {}
    return {
      defaultAnnotationStyle: {
        ...defaultAnnotationStyle,
        ...savedStyle,
        fontWeight: normalizeFontWeight((savedStyle as Partial<AnnotationStyle>).fontWeight),
      },
      canvasBackgroundMode: parsed.canvasBackgroundMode ?? 'grid',
      openWindowAfterScreenshot: parsed.openWindowAfterScreenshot ?? true,
      showAnnotationNumbers: parsed.showAnnotationNumbers ?? true,
    }
  } catch {
    return defaultAppSettings
  }
}

function hexToRgba(hex: string, opacity: number) {
  const normalized = hex.replace('#', '')
  const value =
    normalized.length === 3
      ? normalized
          .split('')
          .map((part) => part + part)
          .join('')
      : normalized
  const red = Number.parseInt(value.slice(0, 2), 16)
  const green = Number.parseInt(value.slice(2, 4), 16)
  const blue = Number.parseInt(value.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${clamp(opacity, 0, 1)})`
}

function measureAnnotationText(content: string, style: AnnotationStyle, reserveCalloutCorner = false, requestedWidth?: number) {
  const padding = style.boxPadding
  const calloutInset = reserveCalloutCorner ? getCalloutTextInset(style) : 0
  const font = `${normalizeFontWeight(style.fontWeight)} ${style.fontSize}px "Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif`
  const measuringCanvas = document.createElement('canvas')
  const context = measuringCanvas.getContext('2d')
  if (!context) {
    return { width: 220, height: Math.max(44, style.fontSize * 1.35 + padding * 2) }
  }

  context.font = font
  const normalizedContent = content || '输入批注'
  const maxTextWidth = 360
  const minTextWidth = content.trim() ? 56 : 160
  const explicitLines = normalizedContent.split(/\r?\n/)
  const wrapLines = (availableTextWidth: number) =>
    explicitLines.flatMap((line) => {
    if (!line) return ['']
    const lines: string[] = []
    let current = ''
    for (const char of Array.from(line)) {
      const candidate = current + char
      if (context.measureText(candidate).width > availableTextWidth && current) {
        lines.push(current)
        current = char
      } else {
        current = candidate
      }
    }
    lines.push(current)
    return lines
  })
  const preferredWrappedLines = wrapLines(maxTextWidth)
  const preferredTextWidth = Math.max(minTextWidth, ...preferredWrappedLines.map((line) => context.measureText(line).width))
  const widestGlyph = Math.max(minTextWidth, ...Array.from(normalizedContent).map((char) => context.measureText(char).width))
  const minWidth = Math.ceil(widestGlyph + padding * 2 + style.boxBorderWidth * 2 + calloutInset)
  const preferredWidth = Math.ceil(preferredTextWidth + padding * 2 + style.boxBorderWidth * 2 + calloutInset)
  const width = requestedWidth === undefined ? preferredWidth : Math.ceil(clamp(requestedWidth, minWidth, preferredWidth))
  const availableTextWidth = Math.max(1, width - padding * 2 - style.boxBorderWidth * 2 - calloutInset)
  const wrappedLines = wrapLines(availableTextWidth)
  const measuredWidth = Math.max(minTextWidth, ...wrappedLines.map((line) => context.measureText(line).width))
  const lineHeight = style.fontSize * 1.35
  const textHeight = Math.ceil(Math.max(style.fontSize * 1.35, wrappedLines.length * lineHeight) + padding * 2 + style.boxBorderWidth * 2)
  return {
    width: Math.ceil(Math.min(width, Math.max(minWidth, measuredWidth + padding * 2 + style.boxBorderWidth * 2 + calloutInset))),
    height: textHeight,
  }
}

function rgbToHex(red: number, green: number, blue: number) {
  return `#${[red, green, blue].map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0')).join('')}`
}

function invertRgb({ red, green, blue }: { red: number; green: number; blue: number }) {
  return rgbToHex(255 - red, 255 - green, 255 - blue)
}

function getCanvasBackgroundRgb(mode: CanvasBackgroundMode) {
  if (mode === 'dark') return { red: 36, green: 39, blue: 46 }
  if (mode === 'white') return { red: 255, green: 255, blue: 255 }
  return { red: 248, green: 250, blue: 252 }
}

function getArrowHaloColor(mainColor: string) {
  const normalized = mainColor.replace('#', '')
  const red = Number.parseInt(normalized.slice(0, 2), 16)
  const green = Number.parseInt(normalized.slice(2, 4), 16)
  const blue = Number.parseInt(normalized.slice(4, 6), 16)
  const brightness = red * 0.299 + green * 0.587 + blue * 0.114
  return brightness > 150 ? '#101828' : '#ffffff'
}

function getCanvasObjectId(target: Konva.Node | null) {
  const node = target?.findAncestor('.canvas-object', true)
  return typeof node?.attrs.objectId === 'string' ? node.attrs.objectId : null
}

function getAnnotationPlacement(arrow: Annotation['arrow']): NonNullable<Annotation['text']['placement']> {
  const dx = arrow.endX - arrow.startX
  const dy = arrow.endY - arrow.startY
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left'
  return dy >= 0 ? 'bottom' : 'top'
}

function getTextPositionForPlacement(
  tail: { x: number; y: number },
  size: { width: number; height: number },
  placement: NonNullable<Annotation['text']['placement']>,
) {
  const gap = 12
  if (placement === 'right') return { x: tail.x + gap, y: tail.y - size.height / 2 }
  if (placement === 'left') return { x: tail.x - gap - size.width, y: tail.y - size.height / 2 }
  if (placement === 'top') return { x: tail.x - size.width / 2, y: tail.y - gap - size.height }
  return { x: tail.x - size.width / 2, y: tail.y + gap }
}

function getArrowTailForText(text: Annotation['text']) {
  const placement = text.placement ?? 'right'
  if (placement === 'right') return { x: text.x, y: text.y + text.height / 2 }
  if (placement === 'left') return { x: text.x + text.width, y: text.y + text.height / 2 }
  if (placement === 'top') return { x: text.x + text.width / 2, y: text.y + text.height }
  return { x: text.x + text.width / 2, y: text.y }
}

function getArrowTailForAnchor(text: Annotation['text'], anchor: { x: number; y: number }) {
  const centerX = text.x + text.width / 2
  const centerY = text.y + text.height / 2
  const dx = anchor.x - centerX
  const dy = anchor.y - centerY
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: dx >= 0 ? text.x + text.width : text.x, y: centerY }
  }
  return { x: centerX, y: dy >= 0 ? text.y + text.height : text.y }
}

function moveAnnotationLabel(objects: CanvasObject[], annotationId: string, dx: number, dy: number) {
  if (dx === 0 && dy === 0) return objects
  return objects.map((item) => {
    if (item.id !== annotationId || item.type !== 'annotation') return item
    const nextText = { ...item.text, x: item.text.x + dx, y: item.text.y + dy }
    const tail = getArrowTailForAnchor(nextText, { x: item.arrow.startX, y: item.arrow.startY })
    return {
      ...item,
      arrow: { ...item.arrow, endX: tail.x, endY: tail.y },
      text: nextText,
    }
  })
}

function useHtmlImage(src: string, onLoad?: (image: HTMLImageElement) => void) {
  const [image, setImage] = useState<HTMLImageElement | null>(null)

  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      setImage(img)
      onLoad?.(img)
    }
    img.src = src
  }, [src, onLoad])

  return image
}

function App() {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<Konva.Stage | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map())
  const activePointerIdRef = useRef<number | null>(null)
  const capturedPointerElementRef = useRef<Element | null>(null)
  const objectsRef = useRef<CanvasObject[]>([])
  const imageMoveGestureRef = useRef<ImageMoveGesture>(null)
  const annotationMoveGestureRef = useRef<AnnotationMoveGesture>(null)
  const panGestureRef = useRef<PanGesture>(null)
  const annotationResizeGestureRef = useRef<AnnotationResizeGesture>(null)
  const draftArrowRef = useRef<DraftArrow>(null)
  const [stageSize, setStageSize] = useState({ width: 1000, height: 600 })
  const [activeTool, setActiveTool] = useState<Tool>('annotate')
  const [objects, setObjects] = useState<CanvasObject[]>([])
  const [past, setPast] = useState<CanvasObject[][]>([])
  const [future, setFuture] = useState<CanvasObject[][]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 })
  const [draftArrow, setDraftArrow] = useState<DraftArrow>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const [isSpacePanning, setIsSpacePanning] = useState(false)
  const [panGesture, setPanGesture] = useState<PanGesture>(null)
  const [imageMoveGesture, setImageMoveGesture] = useState<ImageMoveGesture>(null)
  const [annotationMoveGesture, setAnnotationMoveGesture] = useState<AnnotationMoveGesture>(null)
  const [annotationResizeGesture, setAnnotationResizeGesture] = useState<AnnotationResizeGesture>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [appSettings, setAppSettings] = useState<AppSettings>(() => loadAppSettings())
  const [toast, setToast] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [unsavedPrompt, setUnsavedPrompt] = useState<UnsavedPrompt>(null)

  const editingAnnotation = useMemo(
    () => objects.find((obj): obj is Annotation => obj.type === 'annotation' && obj.id === editingId) ?? null,
    [objects, editingId],
  )
  const selectedAnnotation = useMemo(
    () => objects.find((obj): obj is Annotation => obj.type === 'annotation' && obj.id === selectedId) ?? null,
    [objects, selectedId],
  )
  const selectedObject = useMemo(() => objects.find((obj) => obj.id === selectedId) ?? null, [objects, selectedId])
  const hasCanvasContent = objects.length > 0
  const hasUnsavedChanges = isDirty && hasCanvasContent
  const annotationNumberMap = useMemo(() => {
    const counters = new Map<string, number>()
    const entries: Array<readonly [string, string]> = []
    objects.forEach((obj) => {
      if (obj.type !== 'annotation') return
      const groupKey = obj.sourceImageId ?? '__unbound__'
      const nextIndex = (counters.get(groupKey) ?? 0) + 1
      counters.set(groupKey, nextIndex)
      entries.push([obj.id, formatAnnotationNumber(nextIndex)] as const)
    })
    return new Map(entries)
  }, [objects])
  const activeAnnotationStyle = selectedAnnotation?.style ?? appSettings.defaultAnnotationStyle
  const editingHasNumber = Boolean(editingAnnotation && appSettings.showAnnotationNumbers)
  const editingNumberMetrics = editingAnnotation && editingHasNumber ? getCalloutNumberMetrics(editingAnnotation.style) : null
  const editingNumberSize = editingNumberMetrics?.size ?? 0
  const editingTextSize = editingAnnotation ? measureAnnotationText(editingValue, editingAnnotation.style, editingHasNumber, editingAnnotation.text.width) : null
  const editingCalloutBox =
    editingAnnotation && editingTextSize
      ? {
          ...editingAnnotation.text,
          width: editingTextSize.width,
          height: editingTextSize.height,
        }
      : editingAnnotation?.text
  const editingNumberPosition =
    editingAnnotation && editingHasNumber && editingCalloutBox ? getCalloutNumberPosition(editingCalloutBox, editingAnnotation.style) : null
  const selectedAnnotationBounds = selectedAnnotation && !editingAnnotation ? getAnnotationBounds(selectedAnnotation, appSettings.showAnnotationNumbers) : null
  const deleteButtonPosition =
    selectedAnnotationBounds
      ? {
          left: (selectedAnnotationBounds.maxX + 8) * viewport.zoom + viewport.x,
          top: (selectedAnnotationBounds.minY - 8) * viewport.zoom + viewport.y,
        }
      : selectedObject?.type === 'image'
        ? {
            left: (selectedObject.x + selectedObject.width + 10) * viewport.zoom + viewport.x,
            top: (selectedObject.y - 10) * viewport.zoom + viewport.y,
        }
        : null
  const resizeHandlePosition =
    selectedAnnotationBounds
      ? {
          left: (selectedAnnotationBounds.maxX + 8) * viewport.zoom + viewport.x,
          top: (selectedAnnotationBounds.maxY + 8) * viewport.zoom + viewport.y,
        }
      : null
  const selectedNumberSize = selectedAnnotation ? getCalloutNumberSize(selectedAnnotation.style) : getCalloutNumberSize(defaultAnnotationStyle)
  const deleteButtonSize = selectedAnnotation ? Math.round(clamp(selectedNumberSize * 0.42, 16, 22)) : 16
  const deleteIconSize = selectedAnnotation ? Math.round(deleteButtonSize * 0.58) : 12
  const resizeHandleSize = selectedAnnotation ? Math.round(clamp(selectedNumberSize * 0.66, 22, 30)) : 22
  const resizeIconSize = selectedAnnotation ? Math.round(resizeHandleSize * 0.9) : 20

  useEffect(() => {
    localStorage.setItem(settingsStorageKey, JSON.stringify(appSettings))
  }, [appSettings])

  useEffect(() => {
    objectsRef.current = objects
  }, [objects])

  useEffect(() => {
    imageMoveGestureRef.current = imageMoveGesture
  }, [imageMoveGesture])

  useEffect(() => {
    annotationMoveGestureRef.current = annotationMoveGesture
  }, [annotationMoveGesture])

  useEffect(() => {
    panGestureRef.current = panGesture
  }, [panGesture])

  useEffect(() => {
    annotationResizeGestureRef.current = annotationResizeGesture
  }, [annotationResizeGesture])

  useEffect(() => {
    draftArrowRef.current = draftArrow
  }, [draftArrow])

  const showToast = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast((current) => (current === message ? null : current)), 2400)
  }

  const askUnsavedPrompt = (kind: 'import' | 'close') =>
    new Promise<'save' | 'discard'>((resolve) => {
      setUnsavedPrompt({ kind, resolve })
    })

  const resolveUnsavedPrompt = (choice: 'save' | 'discard') => {
    unsavedPrompt?.resolve(choice)
    setUnsavedPrompt(null)
  }

  const pushHistory = (previous: CanvasObject[]) => {
    setPast((items) => [...items, structuredClone(previous)])
    setFuture([])
  }

  const replaceObjects = (next: CanvasObject[], previous = objects) => {
    pushHistory(previous)
    setObjects(next)
    setIsDirty(next.length > 0 || previous.length > 0)
  }

  const updateDefaultAnnotationStyle = (patch: Partial<AnnotationStyle>) => {
    setAppSettings((settings) => ({
      ...settings,
      defaultAnnotationStyle: {
        ...settings.defaultAnnotationStyle,
        ...patch,
      },
    }))
    if (objects.length > 0) setIsDirty(true)
  }

  const updateAnnotationStyle = (patch: Partial<AnnotationStyle>) => {
    if (!selectedAnnotation) {
      updateDefaultAnnotationStyle(patch)
      return
    }

    const next = objects.map((obj) =>
      obj.id === selectedAnnotation.id && obj.type === 'annotation'
        ? (() => {
            const nextStyle = { ...obj.style, ...patch }
            const nextSize = measureAnnotationText(obj.text.content, nextStyle, appSettings.showAnnotationNumbers)
            const nextText = {
              ...obj.text,
              width: nextSize.width,
              height: nextSize.height,
            }
            const tail = getArrowTailForAnchor(nextText, { x: obj.arrow.startX, y: obj.arrow.startY })
            return {
              ...obj,
              arrow: { ...obj.arrow, endX: tail.x, endY: tail.y },
              text: nextText,
              style: nextStyle,
            }
          })()
        : obj,
    )
    setObjects(next)
    setIsDirty(true)
  }

  const adjustTextStyleByShortcut = (patcher: (style: AnnotationStyle) => Partial<AnnotationStyle>) => {
    const targetId = editingId ?? selectedAnnotation?.id ?? null
    if (!targetId) {
      setAppSettings((settings) => ({
        ...settings,
        defaultAnnotationStyle: {
          ...settings.defaultAnnotationStyle,
          ...patcher(settings.defaultAnnotationStyle),
        },
      }))
      return
    }

    const previous = objects
    const next = objects.map((obj) => {
      if (obj.id !== targetId || obj.type !== 'annotation') return obj
      const nextStyle = { ...obj.style, ...patcher(obj.style) }
      const nextSize = measureAnnotationText(obj.text.content, nextStyle, appSettings.showAnnotationNumbers)
      const nextText = {
        ...obj.text,
        width: nextSize.width,
        height: nextSize.height,
      }
      const tail = getArrowTailForAnchor(nextText, { x: obj.arrow.startX, y: obj.arrow.startY })
      return {
        ...obj,
        arrow: { ...obj.arrow, endX: tail.x, endY: tail.y },
        text: nextText,
        style: nextStyle,
      }
    })
    replaceObjects(next, previous)
  }

  const resetAnnotationStyle = () => {
    setAppSettings((settings) => ({ ...settings, defaultAnnotationStyle }))
    if (objects.length > 0) setIsDirty(true)
    if (selectedAnnotation) {
      setObjects(
        objects.map((obj) => {
          if (obj.id !== selectedAnnotation.id || obj.type !== 'annotation') return obj
          const nextSize = measureAnnotationText(obj.text.content, defaultAnnotationStyle, appSettings.showAnnotationNumbers)
          const nextText = { ...obj.text, width: nextSize.width, height: nextSize.height }
          const tail = getArrowTailForAnchor(nextText, { x: obj.arrow.startX, y: obj.arrow.startY })
          return { ...obj, arrow: { ...obj.arrow, endX: tail.x, endY: tail.y }, text: nextText, style: defaultAnnotationStyle }
        }),
      )
      setIsDirty(true)
    }
  }

  const setCanvasBackgroundMode = (canvasBackgroundMode: CanvasBackgroundMode) => {
    setAppSettings((settings) => ({ ...settings, canvasBackgroundMode }))
    if (objects.length > 0) setIsDirty(true)
  }

  const updateAppSetting = <Key extends keyof AppSettings>(key: Key, value: AppSettings[Key]) => {
    setAppSettings((settings) => ({ ...settings, [key]: value }))
    if (objects.length > 0) setIsDirty(true)
  }

  const screenToWorld = (screenX: number, screenY: number) => ({
    x: (screenX - viewport.x) / viewport.zoom,
    y: (screenY - viewport.y) / viewport.zoom,
  })

  const pointerWorld = () => {
    const stage = stageRef.current
    const pointer = stage?.getPointerPosition()
    if (!pointer) return null
    return screenToWorld(pointer.x, pointer.y)
  }

  const visibleCenterWorld = () => screenToWorld(stageSize.width / 2, stageSize.height / 2)

  const sampleBackgroundInvertedColor = (point: { x: number; y: number }) => {
    const targetImage = [...objects]
      .reverse()
      .find(
        (obj): obj is CanvasImage =>
          obj.type === 'image' && point.x >= obj.x && point.y >= obj.y && point.x <= obj.x + obj.width && point.y <= obj.y + obj.height,
      )

    if (!targetImage) {
      return invertRgb(getCanvasBackgroundRgb(appSettings.canvasBackgroundMode))
    }

    const image = imageCacheRef.current.get(targetImage.id)
    if (!image) {
      return invertRgb(getCanvasBackgroundRgb(appSettings.canvasBackgroundMode))
    }

    const scaleX = image.naturalWidth / targetImage.width
    const scaleY = image.naturalHeight / targetImage.height
    const centerX = Math.round((point.x - targetImage.x) * scaleX)
    const centerY = Math.round((point.y - targetImage.y) * scaleY)
    const sampleSize = 9
    const half = Math.floor(sampleSize / 2)
    const sx = clamp(centerX - half, 0, image.naturalWidth - 1)
    const sy = clamp(centerY - half, 0, image.naturalHeight - 1)
    const sw = Math.min(sampleSize, image.naturalWidth - sx)
    const sh = Math.min(sampleSize, image.naturalHeight - sy)

    try {
      const canvas = document.createElement('canvas')
      canvas.width = sw
      canvas.height = sh
      const context = canvas.getContext('2d')
      if (!context) return invertRgb(getCanvasBackgroundRgb(appSettings.canvasBackgroundMode))
      context.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh)
      const pixels = context.getImageData(0, 0, sw, sh).data
      let red = 0
      let green = 0
      let blue = 0
      const count = pixels.length / 4
      for (let index = 0; index < pixels.length; index += 4) {
        red += pixels[index]
        green += pixels[index + 1]
        blue += pixels[index + 2]
      }
      return invertRgb({ red: red / count, green: green / count, blue: blue / count })
    } catch {
      return invertRgb(getCanvasBackgroundRgb(appSettings.canvasBackgroundMode))
    }
  }

  const addImages = (images: ImagePayload[], worldPoint?: { x: number; y: number }, sourceType: CanvasImage['sourceType'] = 'file') => {
    if (images.length === 0) return
    const spacing = 40
    const existingImages = objects.filter((obj): obj is CanvasImage => obj.type === 'image')
    const fallbackBase = visibleCenterWorld()
    const startBase =
      worldPoint ??
      (existingImages.length
        ? {
            x: Math.max(...existingImages.map((image) => image.x + image.width)) + spacing,
            y: Math.min(...existingImages.map((image) => image.y)),
          }
        : fallbackBase)
    let cursorX = startBase.x
    let cursorY = startBase.y
    const nextImages = images.map((img, index): CanvasImage => {
      const x = worldPoint ? startBase.x + index * spacing : cursorX
      const y = worldPoint ? startBase.y + index * spacing : cursorY
      if (!worldPoint) cursorX = x + img.width + spacing
      return {
        id: uid(),
        type: 'image',
        src: img.dataUrl,
        data: img.dataUrl,
        name: img.name,
        mimeType: img.dataUrl.match(/^data:([^;]+);/)?.[1],
        sourceType,
        zIndex: objects.length + index,
        x,
        y,
        width: img.width,
        height: img.height,
        originalWidth: img.width,
        originalHeight: img.height,
      }
    })
    replaceObjects([...objects, ...nextImages])
    setSelectedId(nextImages[nextImages.length - 1]?.id ?? null)
  }

  const undo = () => {
    setPast((items) => {
      if (items.length === 0) return items
      const previous = items[items.length - 1]
      setFuture((redoItems) => [structuredClone(objects), ...redoItems])
      setObjects(structuredClone(previous))
      setSelectedId(null)
      setEditingId(null)
      setIsDirty(true)
      return items.slice(0, -1)
    })
  }

  const redo = () => {
    setFuture((items) => {
      if (items.length === 0) return items
      const next = items[0]
      setPast((undoItems) => [...undoItems, structuredClone(objects)])
      setObjects(structuredClone(next))
      setSelectedId(null)
      setEditingId(null)
      setIsDirty(true)
      return items.slice(1)
    })
  }

  const deleteSelected = () => {
    if (!selectedId) return
    replaceObjects(objects.filter((obj) => obj.id !== selectedId))
    setSelectedId(null)
  }

  const beginAnnotationResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!selectedAnnotation) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    activePointerIdRef.current = event.pointerId
    capturedPointerElementRef.current = event.currentTarget
    const gesture = {
      annotationId: selectedAnnotation.id,
      pointerX: event.clientX,
      pointerY: event.clientY,
      snapshot: structuredClone(objects),
      text: structuredClone(selectedAnnotation.text),
      style: structuredClone(selectedAnnotation.style),
    }
    annotationResizeGestureRef.current = gesture
    setAnnotationResizeGesture(gesture)
  }

  const updateAnnotationResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!annotationResizeGesture) return
    event.preventDefault()
    event.stopPropagation()
    if (activePointerIdRef.current !== null && event.pointerId !== activePointerIdRef.current) return
    const deltaX = (event.clientX - annotationResizeGesture.pointerX) / viewport.zoom
    const deltaY = (event.clientY - annotationResizeGesture.pointerY) / viewport.zoom
    const scaleBase = Math.max(80, annotationResizeGesture.text.width + annotationResizeGesture.text.height)
    const rawScale = 1 + (deltaX + deltaY) / scaleBase
    const targetFontSize = clamp(annotationResizeGesture.style.fontSize * rawScale, 12, 72)
    const scale = targetFontSize / Math.max(1, annotationResizeGesture.style.fontSize)
    const nextStyle = scaleAnnotationStyle(annotationResizeGesture.style, scale)
    const scaledBaseWidth = annotationResizeGesture.text.width * scale
    const requestedWidth = scaledBaseWidth + deltaX - Math.max(0, deltaY) * 0.85

    setObjects(
      annotationResizeGesture.snapshot.map((obj) => {
        if (obj.id !== annotationResizeGesture.annotationId || obj.type !== 'annotation') return obj
        const nextSize = measureAnnotationText(obj.text.content, nextStyle, appSettings.showAnnotationNumbers, requestedWidth)
        const nextText = {
          ...obj.text,
          width: nextSize.width,
          height: nextSize.height,
        }
        const tail = getArrowTailForAnchor(nextText, { x: obj.arrow.startX, y: obj.arrow.startY })
        return {
          ...obj,
          text: nextText,
          arrow: { ...obj.arrow, endX: tail.x, endY: tail.y },
          style: nextStyle,
        }
      }),
    )
    setIsDirty(true)
  }

  const endAnnotationResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!annotationResizeGesture) return
    event.preventDefault()
    event.stopPropagation()
    if (activePointerIdRef.current !== null && event.pointerId !== activePointerIdRef.current) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    const resized = objects.find((obj): obj is Annotation => obj.id === annotationResizeGesture.annotationId && obj.type === 'annotation')
    pushHistory(annotationResizeGesture.snapshot)
    if (resized) {
      setAppSettings((settings) => ({
        ...settings,
        defaultAnnotationStyle: {
          ...settings.defaultAnnotationStyle,
          fontSize: resized.style.fontSize,
        },
      }))
    }
    activePointerIdRef.current = null
    capturedPointerElementRef.current = null
    annotationResizeGestureRef.current = null
    setAnnotationResizeGesture(null)
    setIsDirty(true)
  }

  const commitTextEdit = () => {
    if (!editingId) return
    const value = editingValue.trim()
    const previous = objects
    const before = objects.find((obj) => obj.id === editingId)
    const measuredSize = before?.type === 'annotation' ? measureAnnotationText(editingValue, before.style, appSettings.showAnnotationNumbers, before.text.width) : null
    const next = value
      ? objects.map((obj) =>
          obj.id === editingId && obj.type === 'annotation'
            ? (() => {
                const nextText = {
                  ...obj.text,
                  content: editingValue,
                  width: measuredSize?.width ?? obj.text.width,
                  height: measuredSize?.height ?? obj.text.height,
                }
                const tail = getArrowTailForAnchor(nextText, { x: obj.arrow.startX, y: obj.arrow.startY })
                return { ...obj, text: nextText, arrow: { ...obj.arrow, endX: tail.x, endY: tail.y } }
              })()
            : obj,
        )
      : objects.filter((obj) => obj.id !== editingId)

    if (JSON.stringify(before) !== JSON.stringify(next.find((obj) => obj.id === editingId))) {
      replaceObjects(next, previous)
    } else {
      setObjects(next)
    }
    setEditingId(null)
    setEditingValue('')
  }

  useEffect(() => {
    const measure = () => {
      const rect = wrapperRef.current?.getBoundingClientRect()
      if (rect) setStageSize({ width: rect.width, height: rect.height })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  useEffect(() => {
    if (editingId) {
      requestAnimationFrame(() => {
        textareaRef.current?.focus()
      })
    }
  }, [editingId])

  useEffect(() => {
    const onKeyDown = async (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isTyping = target?.tagName === 'TEXTAREA'
      if (event.key === ' ') setIsSpacePanning(true)
      const bracketDirection = getBracketShortcutDirection(event)
      if ((event.ctrlKey || event.metaKey) && !event.altKey && bracketDirection !== 0) {
        event.preventDefault()
        if (event.shiftKey) {
          adjustTextStyleByShortcut((style) => ({
            fontWeight: clamp(normalizeFontWeight(style.fontWeight) + bracketDirection * 100, 300, 900),
          }))
        } else {
          adjustTextStyleByShortcut((style) => ({
            fontSize: clamp(style.fontSize + bracketDirection * 2, 12, 72),
          }))
        }
        return
      }
      if (isTyping) {
        if (event.key === 'Escape') {
          event.preventDefault()
          setEditingId(null)
          setEditingValue('')
        }
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
        event.preventDefault()
        const pasted = await window.yami?.readClipboardImage()
        if (pasted) addImages([pasted], undefined, 'clipboard')
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        undo()
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        redo()
      }
      if ((event.ctrlKey || event.metaKey) && event.key === '0') {
        event.preventDefault()
        setZoom(1)
      }
      if (event.key === 'Delete' || event.key === 'Backspace') deleteSelected()
      if (event.key === 'Escape') {
        setSelectedId(null)
        setDraftArrow(null)
      }
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === ' ') setIsSpacePanning(false)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [objects, selectedId, editingId, editingValue, viewport, stageSize])

  useEffect(() => {
    return window.yami?.onMenuCommand((command) => {
      if (command === 'import-project') importProject()
      if (command === 'export-project') exportProject()
      if (command === 'import-images') importByDialog()
      if (command === 'clear-canvas') clearCanvas()
      if (command === 'undo') undo()
      if (command === 'redo') redo()
      if (command === 'delete-selected') deleteSelected()
      if (command === 'clear-selection') setSelectedId(null)
      if (command === 'select-all') setSelectedId(objects[objects.length - 1]?.id ?? null)
      if (command === 'zoom-in') setZoom(viewport.zoom * 1.15)
      if (command === 'zoom-out') setZoom(viewport.zoom * 0.85)
      if (command === 'zoom-reset') setZoom(1)
      if (command === 'fit-window') {
        setViewport({ x: 0, y: 0, zoom: 1 })
      }
      if (command === 'toggle-grid') {
        setCanvasBackgroundMode(appSettings.canvasBackgroundMode === 'grid' ? 'white' : 'grid')
      }
    })
  }, [objects, selectedId, viewport, appSettings])

  useEffect(() => {
    window.yami?.rendererReady?.()
  }, [])

  useEffect(() => {
    return window.yami?.onCloseRequest(() => {
      void requestCloseWindow()
    })
  }, [hasUnsavedChanges, objects, viewport, appSettings])

  useEffect(() => {
    const cleanupCaptured = window.yami?.onScreenshotCaptured((image) => {
      addImages([image], undefined, 'screenshot')
      showToast('截图已加入画布')
      if (appSettings.openWindowAfterScreenshot) void window.yami?.showMainWindow?.()
    })
    const cleanupError = window.yami?.onScreenshotError((message) => showToast(message))
    const cleanupShortcut = window.yami?.onScreenshotShortcutStatus((status) => {
      if (!status.ok && status.message) showToast(status.message)
    })
    return () => {
      cleanupCaptured?.()
      cleanupError?.()
      cleanupShortcut?.()
    }
  }, [objects, viewport, appSettings])

  const setZoom = (nextZoom: number, anchor = { x: stageSize.width / 2, y: stageSize.height / 2 }) => {
    const zoom = clamp(nextZoom, 0.1, 4)
    const worldBefore = screenToWorld(anchor.x, anchor.y)
    setViewport({
      zoom,
      x: anchor.x - worldBefore.x * zoom,
      y: anchor.y - worldBefore.y * zoom,
    })
  }

  const clearCanvas = () => {
    if (objects.length === 0) return
    if (window.confirm('确认清空画布？此操作可以撤回。')) {
      replaceObjects([])
      setSelectedId(null)
      setEditingId(null)
      setEditingValue('')
      setDraftArrow(null)
      setIsDirty(false)
    }
  }

  const importByDialog = async () => {
    const images = await window.yami?.openImages()
    if (images?.length) addImages(images, undefined, 'file')
  }

  const buildProject = (): YamiProjectFile => {
    const now = new Date().toISOString()
    return {
      appName: 'YAMI画布批注',
      version: 1,
      createdAt: now,
      updatedAt: now,
      viewport,
      appSettings,
      objects,
    }
  }

  const saveCurrentProject = async () => {
    const result = await window.yami?.saveProjectFile(buildProject())
    if (result && !result.canceled) {
      showToast('工程文件已导出')
      setIsDirty(false)
      return true
    }
    return false
  }

  const exportProject = async () => {
    await saveCurrentProject()
  }

  const requestCloseWindow = async () => {
    if (unsavedPrompt) return
    if (!hasUnsavedChanges) {
      await window.yami?.closeWindowNow?.()
      return
    }
    const choice = await askUnsavedPrompt('close')
    if (choice === 'save') {
      const saved = await saveCurrentProject()
      if (saved) await window.yami?.closeWindowNow?.()
      return
    }
    await window.yami?.closeWindowNow?.()
  }

  const restoreProject = (project: YamiProjectFile) => {
    if (project.appName !== 'YAMI画布批注' || project.version !== 1 || !Array.isArray(project.objects)) {
      showToast('工程文件格式不正确')
      return
    }
    const normalizedObjects = project.objects.map((obj, index): CanvasObject => {
      if (obj.type === 'image') {
        const data = obj.data ?? obj.src
        return {
          ...obj,
          src: data,
          data,
          sourceType: obj.sourceType ?? 'project',
          zIndex: obj.zIndex ?? index,
          mimeType: obj.mimeType ?? obj.src.match(/^data:([^;]+);/)?.[1],
        }
      }
      const placement = obj.text.placement ?? getAnnotationPlacement(obj.arrow)
      const nextText = { ...obj.text, placement }
      const tail = getArrowTailForAnchor(nextText, { x: obj.arrow.startX, y: obj.arrow.startY })
      return {
        ...obj,
        arrow: {
          ...obj.arrow,
          endX: tail.x,
          endY: tail.y,
        },
        text: {
          ...nextText,
          placement,
        },
        style: {
          ...defaultAnnotationStyle,
          ...obj.style,
          fontWeight: normalizeFontWeight(obj.style?.fontWeight),
        },
      }
    })
    setObjects(normalizedObjects)
    setViewport(project.viewport ?? { x: 0, y: 0, zoom: 1 })
    setAppSettings({
      ...defaultAppSettings,
      ...(project.appSettings ?? {}),
      defaultAnnotationStyle: {
        ...defaultAnnotationStyle,
        ...(project.appSettings?.defaultAnnotationStyle ?? {}),
        fontWeight: normalizeFontWeight(project.appSettings?.defaultAnnotationStyle?.fontWeight),
      },
    })
    setSelectedId(null)
    setEditingId(null)
    setEditingValue('')
    setDraftArrow(null)
    setPast([])
    setFuture([])
    setIsDirty(false)
    showToast('工程文件已导入')
  }

  const confirmBeforeImport = async () => {
    if (!hasUnsavedChanges) return true
    const choice = await askUnsavedPrompt('import')
    if (choice === 'discard') return true
    return saveCurrentProject()
  }

  const requestImportProject = async (loadProject: () => Promise<YamiProjectFile | null>) => {
    const canImport = await confirmBeforeImport()
    if (!canImport) return
    try {
      const project = await loadProject()
      if (project) restoreProject(project)
    } catch {
      showToast('工程文件导入失败')
    }
  }

  const readDroppedProjectFile = async (file: File) => {
    const projectPath = (file as File & { path?: string }).path
    if (projectPath && window.yami?.readProjectFile) {
      const result = await window.yami.readProjectFile(projectPath)
      return result && !result.canceled && result.project ? result.project : null
    }
    const content = await file.text()
    return JSON.parse(content) as YamiProjectFile
  }

  const importProject = async () => {
    await requestImportProject(async () => {
      const result = await window.yami?.openProjectFile()
      return result && !result.canceled && result.project ? result.project : null
    })
  }

  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault()
    const rect = wrapperRef.current?.getBoundingClientRect()
    const worldPoint = rect ? screenToWorld(event.clientX - rect.left, event.clientY - rect.top) : visibleCenterWorld()
    const allFiles = Array.from(event.dataTransfer.files)
    const projectFile = allFiles.find((file) => file.name.toLowerCase().endsWith('.yami'))
    if (projectFile) {
      await requestImportProject(() => readDroppedProjectFile(projectFile))
      return
    }

    const files = allFiles.filter((file) => {
      const fileName = file.name.toLowerCase()
      return (
        file.type.startsWith('image/') ||
        fileName.endsWith('.png') ||
        fileName.endsWith('.jpg') ||
        fileName.endsWith('.jpeg') ||
        fileName.endsWith('.webp') ||
        fileName.endsWith('.gif')
      )
    })
    if (files.length === 0) {
      showToast('暂不支持该文件类型')
      return
    }
    const paths = files.map((file) => (file as File & { path?: string }).path).filter(Boolean) as string[]

    if (paths.length && window.yami?.readImageFiles) {
      const images = await window.yami.readImageFiles(paths)
      addImages(images, worldPoint, 'drag')
      return
    }

    const browserImages = await Promise.all(
      files.map(
        (file) =>
          new Promise<ImagePayload>((resolve, reject) => {
            const img = new Image()
            const reader = new FileReader()
            reader.onload = () => {
              img.onload = () => resolve({ dataUrl: String(reader.result), width: img.naturalWidth, height: img.naturalHeight, name: file.name })
              img.onerror = reject
              img.src = String(reader.result)
            }
            reader.onerror = reject
            reader.readAsDataURL(file)
          }),
      ),
    )
    addImages(browserImages, worldPoint, 'drag')
  }

  const capturePointer = (event: Konva.KonvaEventObject<PointerEvent>) => {
    activePointerIdRef.current = event.evt.pointerId
    const target = event.evt.target
    if (target instanceof Element && typeof target.setPointerCapture === 'function') {
      try {
        target.setPointerCapture(event.evt.pointerId)
        capturedPointerElementRef.current = target
      } catch {
        capturedPointerElementRef.current = null
      }
    }
  }

  const releaseCapturedPointer = () => {
    const pointerId = activePointerIdRef.current
    const element = capturedPointerElementRef.current
    if (pointerId !== null && element instanceof Element && typeof element.releasePointerCapture === 'function') {
      try {
        if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId)
      } catch {
        // The browser can drop capture on its own when the window loses focus.
      }
    }
    activePointerIdRef.current = null
    capturedPointerElementRef.current = null
  }

  const endPointerInteraction = (commitDraft = true) => {
    const activeImageMoveGesture = imageMoveGestureRef.current
    const activeAnnotationMoveGesture = annotationMoveGestureRef.current
    const activePanGesture = panGestureRef.current
    const activeAnnotationResizeGesture = annotationResizeGestureRef.current
    const activeDraftArrow = draftArrowRef.current

    releaseCapturedPointer()

    if (activeImageMoveGesture) {
      imageMoveGestureRef.current = null
      pushHistory(activeImageMoveGesture.snapshot)
      setIsDirty(true)
      setImageMoveGesture(null)
      return
    }

    if (activeAnnotationMoveGesture) {
      annotationMoveGestureRef.current = null
      if (activeAnnotationMoveGesture.moved) {
        pushHistory(activeAnnotationMoveGesture.snapshot)
        setIsDirty(true)
      }
      setAnnotationMoveGesture(null)
      return
    }

    if (activePanGesture) {
      panGestureRef.current = null
      setPanGesture(null)
      return
    }

    if (activeAnnotationResizeGesture) {
      annotationResizeGestureRef.current = null
      const resized = objectsRef.current.find((obj): obj is Annotation => obj.id === activeAnnotationResizeGesture.annotationId && obj.type === 'annotation')
      pushHistory(activeAnnotationResizeGesture.snapshot)
      if (resized) {
        setAppSettings((settings) => ({
          ...settings,
          defaultAnnotationStyle: {
            ...settings.defaultAnnotationStyle,
            fontSize: resized.style.fontSize,
          },
        }))
      }
      setAnnotationResizeGesture(null)
      setIsDirty(true)
      return
    }

    if (!activeDraftArrow) return
    draftArrowRef.current = null

    const distance = Math.hypot(activeDraftArrow.endX - activeDraftArrow.startX, activeDraftArrow.endY - activeDraftArrow.startY)
    if (!commitDraft || distance < 8) {
      setDraftArrow(null)
      return
    }

    const id = uid()
    const initialTextSize = measureAnnotationText('', appSettings.defaultAnnotationStyle, appSettings.showAnnotationNumbers)
    const placement = getAnnotationPlacement(activeDraftArrow)
    const textPosition = getTextPositionForPlacement({ x: activeDraftArrow.endX, y: activeDraftArrow.endY }, initialTextSize, placement)
    const arrowTail = getArrowTailForText({ ...textPosition, content: '', width: initialTextSize.width, height: initialTextSize.height, placement })
    const annotation: Annotation = {
      id,
      type: 'annotation',
      sourceImageId: activeDraftArrow.sourceImageId,
      arrow: {
        startX: activeDraftArrow.startX,
        startY: activeDraftArrow.startY,
        endX: arrowTail.x,
        endY: arrowTail.y,
      },
      text: {
        x: textPosition.x,
        y: textPosition.y,
        content: '',
        width: initialTextSize.width,
        height: initialTextSize.height,
        placement,
      },
      style: {
        ...appSettings.defaultAnnotationStyle,
        computedArrowColor: activeDraftArrow.computedArrowColor,
      },
    }
    replaceObjects([...objectsRef.current, annotation], objectsRef.current)
    setSelectedId(id)
    setEditingId(id)
    setEditingValue('')
    setDraftArrow(null)
  }

  const pointerBelongsToActiveDrag = (event: Konva.KonvaEventObject<PointerEvent>) => activePointerIdRef.current === null || event.evt.pointerId === activePointerIdRef.current

  const handlePointerDown = (event: Konva.KonvaEventObject<PointerEvent>) => {
    if (event.evt.button !== 0) return
    capturePointer(event)
    const point = pointerWorld()
    if (!point) return
    const objectId = getCanvasObjectId(event.target)
    const targetObject = objects.find((obj) => obj.id === objectId)
    const hitEmpty = event.target === event.target.getStage() || !objectId

    if (targetObject?.type === 'annotation') {
      setSelectedId(targetObject.id)
      setActiveTool('select')
      if (editingId !== targetObject.id) {
        setEditingId(null)
        setEditingValue('')
      }
      if (editingId !== targetObject.id) {
        const pointer = stageRef.current?.getPointerPosition()
        if (pointer) {
          const gesture = { annotationId: targetObject.id, pointerX: pointer.x, pointerY: pointer.y, snapshot: structuredClone(objects), moved: false }
          annotationMoveGestureRef.current = gesture
          setAnnotationMoveGesture(gesture)
        }
      }
      return
    }

    if (activeTool === 'pan' || isSpacePanning || hitEmpty) {
      const pointer = stageRef.current?.getPointerPosition()
      if (pointer) {
        const gesture = { x: pointer.x, y: pointer.y, viewport }
        panGestureRef.current = gesture
        setPanGesture(gesture)
      }
      if (hitEmpty) setSelectedId(null)
      return
    }

    if (targetObject?.type === 'image' && activeTool === 'select') {
      setSelectedId(targetObject.id)
      return
    }

    if (activeTool === 'annotate' || targetObject?.type === 'image') {
      const computedArrowColor = appSettings.defaultAnnotationStyle.arrowAutoContrast ? sampleBackgroundInvertedColor(point) : undefined
      setSelectedId(null)
      const nextDraftArrow = { startX: point.x, startY: point.y, endX: point.x, endY: point.y, computedArrowColor, sourceImageId: targetObject?.type === 'image' ? targetObject.id : undefined }
      draftArrowRef.current = nextDraftArrow
      setDraftArrow(nextDraftArrow)
      return
    }
  }

  const handlePointerMove = (event: Konva.KonvaEventObject<PointerEvent>) => {
    if (!pointerBelongsToActiveDrag(event)) return
    const activeImageMoveGesture = imageMoveGestureRef.current
    const activeAnnotationMoveGesture = annotationMoveGestureRef.current
    const activePanGesture = panGestureRef.current
    const activeDraftArrow = draftArrowRef.current
    if ((activeImageMoveGesture || activeAnnotationMoveGesture || activePanGesture || activeDraftArrow) && (event.evt.buttons & 1) === 0) {
      endPointerInteraction()
      return
    }
    const point = pointerWorld()
    const pointer = stageRef.current?.getPointerPosition()
    if (activeImageMoveGesture && pointer) {
      const deltaX = (pointer.x - activeImageMoveGesture.pointerX) / viewport.zoom
      const deltaY = (pointer.y - activeImageMoveGesture.pointerY) / viewport.zoom
      setObjects(
        activeImageMoveGesture.snapshot.map((item) => {
          if (item.id === activeImageMoveGesture.imageId && item.type === 'image') return { ...item, x: item.x + deltaX, y: item.y + deltaY }
          if (item.type === 'annotation' && item.sourceImageId === activeImageMoveGesture.imageId) {
            return {
              ...item,
              arrow: {
                startX: item.arrow.startX + deltaX,
                startY: item.arrow.startY + deltaY,
                endX: item.arrow.endX + deltaX,
                endY: item.arrow.endY + deltaY,
              },
              text: {
                ...item.text,
                x: item.text.x + deltaX,
                y: item.text.y + deltaY,
              },
            }
          }
          return item
        }),
      )
      return
    }
    if (activeAnnotationMoveGesture && pointer) {
      const deltaX = (pointer.x - activeAnnotationMoveGesture.pointerX) / viewport.zoom
      const deltaY = (pointer.y - activeAnnotationMoveGesture.pointerY) / viewport.zoom
      const moved = activeAnnotationMoveGesture.moved || Math.hypot(deltaX, deltaY) > 0.5
      const nextGesture = { ...activeAnnotationMoveGesture, moved }
      annotationMoveGestureRef.current = nextGesture
      setAnnotationMoveGesture(nextGesture)
      const next = moveAnnotationLabel(activeAnnotationMoveGesture.snapshot, activeAnnotationMoveGesture.annotationId, deltaX, deltaY)
      objectsRef.current = next
      setObjects(next)
      return
    }
    if (activePanGesture && pointer) {
      setViewport({
        ...activePanGesture.viewport,
        x: activePanGesture.viewport.x + pointer.x - activePanGesture.x,
        y: activePanGesture.viewport.y + pointer.y - activePanGesture.y,
      })
      return
    }
    if (activeDraftArrow && point) {
      const nextDraftArrow = { ...activeDraftArrow, endX: point.x, endY: point.y }
      draftArrowRef.current = nextDraftArrow
      setDraftArrow(nextDraftArrow)
    }
  }

  const handlePointerUp = (event: Konva.KonvaEventObject<PointerEvent>) => {
    if (!pointerBelongsToActiveDrag(event)) return
    endPointerInteraction()
  }

  const handleWheel = (event: Konva.KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault()
    const pointer = stageRef.current?.getPointerPosition()
    if (!pointer) return
    const direction = event.evt.deltaY > 0 ? -1 : 1
    setZoom(viewport.zoom * (direction > 0 ? 1.08 : 0.92), pointer)
  }

  useEffect(() => {
    const endDrag = () => endPointerInteraction()
    const cancelDrag = () => endPointerInteraction(false)
    const endDragWhenHidden = () => {
      if (document.visibilityState === 'hidden') cancelDrag()
    }

    window.addEventListener('pointerup', endDrag)
    window.addEventListener('mouseup', endDrag)
    window.addEventListener('pointercancel', cancelDrag)
    window.addEventListener('blur', cancelDrag)
    document.addEventListener('visibilitychange', endDragWhenHidden)
    return () => {
      window.removeEventListener('pointerup', endDrag)
      window.removeEventListener('mouseup', endDrag)
      window.removeEventListener('pointercancel', cancelDrag)
      window.removeEventListener('blur', cancelDrag)
      document.removeEventListener('visibilitychange', endDragWhenHidden)
    }
  })

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">YAMI画布批注</div>
        <button className="toolbar-button primary" onClick={importProject}>
          <ImagePlus size={17} /> 导入工程
        </button>
        <button className="toolbar-button" onClick={exportProject}>
          <Download size={17} /> 导出工程
        </button>
        <button className="toolbar-button primary" onClick={importByDialog}>
          <ImagePlus size={17} /> 导入图片
        </button>
        <button className="toolbar-button" onClick={undo} disabled={past.length === 0} title="撤回 Ctrl+Z">
          <Undo2 size={17} /> 撤回
        </button>
        <button className="toolbar-button" onClick={redo} disabled={future.length === 0} title="重做 Ctrl+Y">
          <Redo2 size={17} /> 重做
        </button>
        <button className="toolbar-button danger" onClick={clearCanvas}>
          <Trash2 size={17} /> 清空画布
        </button>
        <button className="toolbar-button icon-only" onClick={() => window.yami?.toggleFullscreen()} title="全屏/还原">
          <Expand size={17} />
        </button>
      </header>

      <main className="workspace">
        <aside className="leftbar">
          <ToolButton active={activeTool === 'select'} icon={<MousePointer2 size={21} />} label="选择" onClick={() => setActiveTool('select')} />
          <ToolButton active={activeTool === 'annotate'} icon={<Brush size={21} />} label="批注" onClick={() => setActiveTool('annotate')} />
          <ToolButton active={activeTool === 'pan'} icon={<Hand size={21} />} label="拖动画布" onClick={() => setActiveTool('pan')} />
          <ToolButton active={settingsOpen} icon={<Settings size={21} />} label="设置" onClick={() => setSettingsOpen((open) => !open)} />
        </aside>

        <section
          ref={wrapperRef}
          className={`canvas-wrap tool-${activeTool} canvas-${appSettings.canvasBackgroundMode}`}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          <Stage
            ref={stageRef}
            width={stageSize.width}
            height={stageSize.height}
            draggable={false}
            x={viewport.x}
            y={viewport.y}
            scaleX={viewport.zoom}
            scaleY={viewport.zoom}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={() => endPointerInteraction(false)}
            onWheel={handleWheel}
          >
            <Layer listening={false}>
              <CanvasBackground viewport={viewport} stageSize={stageSize} mode={appSettings.canvasBackgroundMode} />
            </Layer>
            <Layer>
              {objects.map((obj) =>
                obj.type === 'image' ? (
                  <ImageNode
                    key={obj.id}
                    imageObject={obj}
                    selected={selectedId === obj.id}
                    movable={activeTool === 'select'}
                    onImageLoad={(image) => imageCacheRef.current.set(obj.id, image)}
                    onSelect={() => activeTool === 'select' && setSelectedId(obj.id)}
                    onMoveStart={(event) => {
                      const pointer = stageRef.current?.getPointerPosition()
                      if (!pointer) return
                      capturePointer(event)
                      const gesture = { imageId: obj.id, pointerX: pointer.x, pointerY: pointer.y, snapshot: structuredClone(objects) }
                      imageMoveGestureRef.current = gesture
                      setImageMoveGesture(gesture)
                    }}
                  />
                ) : (
                  <AnnotationNode
                    key={obj.id}
                    annotation={obj}
                    annotationNumber={appSettings.showAnnotationNumbers ? annotationNumberMap.get(obj.id) : undefined}
                    selected={selectedId === obj.id}
                    editing={editingId === obj.id}
                    editingText={editingId === obj.id ? editingCalloutBox : undefined}
                    draggable={false}
                    onSelect={() => setSelectedId(obj.id)}
                    onEdit={() => {
                      setSelectedId(obj.id)
                      setEditingId(obj.id)
                      setEditingValue(obj.text.content)
                    }}
                  />
                ),
              )}
              {draftArrow ? (
                <FloatingArrow
                  points={[draftArrow.endX, draftArrow.endY, draftArrow.startX, draftArrow.startY]}
                  style={{ ...appSettings.defaultAnnotationStyle, computedArrowColor: draftArrow.computedArrowColor }}
                  listening={false}
                />
              ) : null}
            </Layer>
          </Stage>

          {objects.length === 0 ? (
            <div className="empty-state">
              <ImagePlus size={34} />
              <span>拖入图片，或按 Ctrl + V 粘贴截图</span>
            </div>
          ) : null}

          {editingAnnotation && editingCalloutBox ? (
            <div
              className="annotation-editor-callout"
              style={{
                left: editingCalloutBox.x * viewport.zoom + viewport.x,
                top: editingCalloutBox.y * viewport.zoom + viewport.y,
                width: editingCalloutBox.width * viewport.zoom,
                height: editingCalloutBox.height * viewport.zoom,
                minWidth: editingCalloutBox.width * viewport.zoom,
                minHeight: editingCalloutBox.height * viewport.zoom,
                background: hexToRgba(editingAnnotation.style.boxBackgroundColor, editingAnnotation.style.boxOpacity),
                borderColor: editingAnnotation.style.boxBorderColor,
                borderRadius: editingAnnotation.style.boxBorderRadius * viewport.zoom,
                borderWidth: editingAnnotation.style.boxBorderWidth * viewport.zoom,
              }}
            >
              <textarea
                ref={textareaRef}
                className="annotation-editor"
                style={{
                  left: 0,
                  top: 0,
                  width: '100%',
                  minWidth: 0,
                  height: '100%',
                  minHeight: '100%',
                  marginLeft: 0,
                  fontSize: editingAnnotation.style.fontSize * viewport.zoom,
                  fontWeight: normalizeFontWeight(editingAnnotation.style.fontWeight),
                  fontFamily: '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif',
                  textShadow:
                    normalizeFontWeight(editingAnnotation.style.fontWeight) >= 850
                      ? `0 0 0 ${editingAnnotation.style.textColor}, 0.55px 0 0 ${editingAnnotation.style.textColor}, -0.55px 0 0 ${editingAnnotation.style.textColor}`
                      : undefined,
                  WebkitTextStroke: normalizeFontWeight(editingAnnotation.style.fontWeight) >= 850 ? `${0.28 * viewport.zoom}px ${editingAnnotation.style.textColor}` : undefined,
                  color: editingAnnotation.style.textColor,
                  paddingTop: editingAnnotation.style.boxPadding * viewport.zoom,
                  paddingRight: editingAnnotation.style.boxPadding * viewport.zoom,
                  paddingBottom: editingAnnotation.style.boxPadding * viewport.zoom,
                  paddingLeft: (editingAnnotation.style.boxPadding + (editingHasNumber ? getCalloutTextInset(editingAnnotation.style) : 0)) * viewport.zoom,
                }}
                value={editingValue}
                onChange={(event) => setEditingValue(event.target.value)}
                onBlur={commitTextEdit}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    setEditingId(null)
                    setEditingValue('')
                  }
                }}
              />
              {editingHasNumber && editingNumberPosition ? (
                <div
                  className="annotation-editor-number"
                  style={{
                    left: (editingNumberPosition.x - editingCalloutBox.x) * viewport.zoom,
                    top: (editingNumberPosition.y - editingCalloutBox.y) * viewport.zoom,
                    width: editingNumberSize * viewport.zoom,
                    height: editingNumberSize * viewport.zoom,
                  }}
                >
                  <CalloutNumberHtmlCanvas
                    size={editingNumberSize * viewport.zoom}
                    logicalSize={editingNumberSize}
                    radius={editingNumberMetrics?.radius ?? 10}
                    fontSize={editingNumberMetrics?.fontSize ?? editingAnnotation.style.fontSize}
                    value={annotationNumberMap.get(editingAnnotation.id) ?? ''}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {deleteButtonPosition ? (
            <button
              className="floating-delete-button"
              style={{ left: deleteButtonPosition.left, top: deleteButtonPosition.top, width: deleteButtonSize, height: deleteButtonSize }}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={deleteSelected}
              title="删除选中对象"
            >
              <X size={deleteIconSize} strokeWidth={3} />
            </button>
          ) : null}
          {resizeHandlePosition ? (
            <button
              className={`annotation-resize-handle ${annotationResizeGesture ? 'active' : ''}`}
              style={{ left: resizeHandlePosition.left, top: resizeHandlePosition.top, width: resizeHandleSize, height: resizeHandleSize }}
              onPointerDown={beginAnnotationResize}
              onPointerMove={updateAnnotationResize}
              onPointerUp={endAnnotationResize}
              onPointerCancel={endAnnotationResize}
              title="拖动缩放文本框"
              aria-label="拖动缩放文本框"
            >
              <ArrowDownRight size={resizeIconSize} strokeWidth={2.6} />
            </button>
          ) : null}
        </section>

        {settingsOpen ? (
          <SettingsPanel
            style={activeAnnotationStyle}
            selectedAnnotation={Boolean(selectedAnnotation)}
            backgroundMode={appSettings.canvasBackgroundMode}
            openWindowAfterScreenshot={appSettings.openWindowAfterScreenshot}
            showAnnotationNumbers={appSettings.showAnnotationNumbers}
            onStyleChange={updateAnnotationStyle}
            onResetStyle={resetAnnotationStyle}
            onBackgroundChange={setCanvasBackgroundMode}
            onOpenWindowAfterScreenshotChange={(openWindowAfterScreenshot) => updateAppSetting('openWindowAfterScreenshot', openWindowAfterScreenshot)}
            onShowAnnotationNumbersChange={(showAnnotationNumbers) => updateAppSetting('showAnnotationNumbers', showAnnotationNumbers)}
            onClose={() => setSettingsOpen(false)}
          />
        ) : null}
      </main>

      <footer className="zoombar">
        <button className="zoom-button" onClick={() => setZoom(1)} title="恢复 100%">
          <Eraser size={16} />
        </button>
        <input
          aria-label="画布缩放"
          type="range"
          min={10}
          max={400}
          value={Math.round(viewport.zoom * 100)}
          onChange={(event) => setZoom(Number(event.target.value) / 100)}
        />
        <output>{Math.round(viewport.zoom * 100)}%</output>
      </footer>
      {toast ? <div className="toast-message">{toast}</div> : null}
      {unsavedPrompt ? (
        <div className="blocking-modal-backdrop" role="presentation">
          <div className="blocking-modal" role="dialog" aria-modal="true" aria-label={unsavedPrompt.kind === 'import' ? '导入工程前保存提示' : '关闭应用前保存提示'}>
            <h2>当前工程尚未保存</h2>
            <p>是否先导出工程？</p>
            <div className="blocking-modal-actions">
              <button className="toolbar-button primary" onClick={() => resolveUnsavedPrompt('save')}>
                {unsavedPrompt.kind === 'import' ? '保存并导入' : '保存并关闭'}
              </button>
              <button className="toolbar-button danger" onClick={() => resolveUnsavedPrompt('discard')}>
                {unsavedPrompt.kind === 'import' ? '不保存，直接导入' : '不保存，直接关闭'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ToolButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button className={`tool-button ${active ? 'active' : ''}`} onClick={onClick} title={label}>
      {icon}
      <span>{label}</span>
    </button>
  )
}

function SettingsPanel({
  style,
  selectedAnnotation,
  backgroundMode,
  openWindowAfterScreenshot,
  showAnnotationNumbers,
  onStyleChange,
  onResetStyle,
  onBackgroundChange,
  onOpenWindowAfterScreenshotChange,
  onShowAnnotationNumbersChange,
  onClose,
}: {
  style: AnnotationStyle
  selectedAnnotation: boolean
  backgroundMode: CanvasBackgroundMode
  openWindowAfterScreenshot: boolean
  showAnnotationNumbers: boolean
  onStyleChange: (patch: Partial<AnnotationStyle>) => void
  onResetStyle: () => void
  onBackgroundChange: (mode: CanvasBackgroundMode) => void
  onOpenWindowAfterScreenshotChange: (value: boolean) => void
  onShowAnnotationNumbersChange: (value: boolean) => void
  onClose: () => void
}) {
  return (
    <aside className="settings-panel" aria-label="设置面板">
      <div className="settings-header">
        <div>
          <h2>设置</h2>
          <p>{selectedAnnotation ? '正在修改选中的批注' : '正在修改默认批注样式'}</p>
        </div>
        <button className="panel-close" onClick={onClose} title="关闭设置">
          关闭
        </button>
      </div>

      <section className="settings-section">
        <h3>批注样式设置</h3>
        <fieldset>
          <legend>箭头线条设置</legend>
          <ColorControl label="线条颜色" value={style.arrowColor} disabled={style.arrowAutoContrast} onChange={(arrowColor) => onStyleChange({ arrowColor })} />
          <label className="setting-row checkbox-row">
            <span>自动反色</span>
            <input type="checkbox" checked={style.arrowAutoContrast} onChange={(event) => onStyleChange({ arrowAutoContrast: event.target.checked })} />
          </label>
          {style.arrowAutoContrast ? <p className="setting-hint">自动反色已开启，线条颜色由背景自动决定。</p> : null}
          <RangeControl label="线条粗细" value={style.arrowWidth} min={1} max={12} unit="px" onChange={(arrowWidth) => onStyleChange({ arrowWidth })} />
        </fieldset>

        <fieldset>
          <legend>文字设置</legend>
          <ColorControl label="文字颜色" value={style.textColor} onChange={(textColor) => onStyleChange({ textColor })} />
          <RangeControl label="文字大小" value={style.fontSize} min={12} max={72} unit="px" onChange={(fontSize) => onStyleChange({ fontSize })} />
          <RangeControl label="文字粗细" value={normalizeFontWeight(style.fontWeight)} min={300} max={900} step={100} onChange={(fontWeight) => onStyleChange({ fontWeight })} />
        </fieldset>

        <fieldset>
          <legend>文字框设置</legend>
          <ColorControl label="背景色" value={style.boxBackgroundColor} onChange={(boxBackgroundColor) => onStyleChange({ boxBackgroundColor })} />
          <ColorControl label="边框颜色" value={style.boxBorderColor} onChange={(boxBorderColor) => onStyleChange({ boxBorderColor })} />
          <RangeControl label="边框粗细" value={style.boxBorderWidth} min={0} max={6} unit="px" onChange={(boxBorderWidth) => onStyleChange({ boxBorderWidth })} />
          <RangeControl label="圆角" value={style.boxBorderRadius} min={0} max={16} unit="px" onChange={(boxBorderRadius) => onStyleChange({ boxBorderRadius })} />
          <RangeControl label="内边距" value={style.boxPadding} min={4} max={20} unit="px" onChange={(boxPadding) => onStyleChange({ boxPadding })} />
          <RangeControl
            label="透明度"
            value={Math.round(style.boxOpacity * 100)}
            min={0}
            max={100}
            unit="%"
            onChange={(boxOpacity) => onStyleChange({ boxOpacity: boxOpacity / 100 })}
          />
        </fieldset>

        <button className="reset-button" onClick={onResetStyle}>
          恢复默认样式
        </button>
      </section>

      <section className="settings-section">
        <h3>截图与编号</h3>
        <fieldset className="compact-settings-fieldset">
          <legend>截图设置</legend>
          <label className="setting-row checkbox-row wide-checkbox-row">
            <span>截图后自动打开窗口</span>
            <input type="checkbox" checked={openWindowAfterScreenshot} onChange={(event) => onOpenWindowAfterScreenshotChange(event.target.checked)} />
          </label>
          <p className="setting-hint shortcut-hint">全局快捷键：Ctrl + Alt + A</p>
        </fieldset>
        <fieldset className="compact-settings-fieldset">
          <legend>编号设置</legend>
          <label className="setting-row checkbox-row wide-checkbox-row">
            <span>显示批注编号</span>
            <input type="checkbox" checked={showAnnotationNumbers} onChange={(event) => onShowAnnotationNumbersChange(event.target.checked)} />
          </label>
        </fieldset>
      </section>

      <section className="settings-section">
        <h3>画布背景设置</h3>
        <div className="background-options">
          <BackgroundOption mode="grid" current={backgroundMode} label="默认网格" detail="浅色网格，适合日常批注" onChange={onBackgroundChange} />
          <BackgroundOption mode="white" current={backgroundMode} label="纯白背景" detail="干净截图，不显示网格" onChange={onBackgroundChange} />
          <BackgroundOption mode="dark" current={backgroundMode} label="深色高级灰" detail="深灰背景，低对比网格" onChange={onBackgroundChange} />
        </div>
      </section>
    </aside>
  )
}

function ColorControl({ label, value, disabled = false, onChange }: { label: string; value: string; disabled?: boolean; onChange: (value: string) => void }) {
  return (
    <label className={`setting-row ${disabled ? 'disabled-row' : ''}`}>
      <span>{label}</span>
      <input type="color" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function RangeControl({
  label,
  value,
  min,
  max,
  unit = '',
  step = 1,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  unit?: string
  step?: number
  onChange: (value: number) => void
}) {
  const roundedValue = Math.round(clamp(value, min, max))

  return (
    <label className="setting-row range-row">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={roundedValue} onChange={(event) => onChange(Math.round(Number(event.target.value)))} />
      <span className="range-value">
        {roundedValue}
        {unit}
      </span>
    </label>
  )
}

function BackgroundOption({
  mode,
  current,
  label,
  detail,
  onChange,
}: {
  mode: CanvasBackgroundMode
  current: CanvasBackgroundMode
  label: string
  detail: string
  onChange: (mode: CanvasBackgroundMode) => void
}) {
  return (
    <button className={`background-option background-option-${mode} ${current === mode ? 'active' : ''}`} onClick={() => onChange(mode)}>
      <span className="background-swatch" />
      <span className="background-copy">
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
    </button>
  )
}

function CanvasBackground({ viewport, stageSize, mode }: { viewport: Viewport; stageSize: { width: number; height: number }; mode: CanvasBackgroundMode }) {
  const step = 64
  const startX = Math.floor((-viewport.x / viewport.zoom) / step) * step - step
  const endX = startX + stageSize.width / viewport.zoom + step * 3
  const startY = Math.floor((-viewport.y / viewport.zoom) / step) * step - step
  const endY = startY + stageSize.height / viewport.zoom + step * 3
  const backgroundFill = mode === 'white' ? '#ffffff' : mode === 'dark' ? '#24272e' : '#f8fafc'
  const gridStroke = mode === 'dark' ? '#343a46' : '#e2e8f0'
  const showGrid = mode !== 'white'
  const lines = []

  if (showGrid) {
    for (let x = startX; x < endX; x += step) {
      lines.push(<Line key={`x-${x}`} points={[x, startY, x, endY]} stroke={gridStroke} opacity={mode === 'dark' ? 0.45 : 1} strokeWidth={1 / viewport.zoom} />)
    }
    for (let y = startY; y < endY; y += step) {
      lines.push(<Line key={`y-${y}`} points={[startX, y, endX, y]} stroke={gridStroke} opacity={mode === 'dark' ? 0.45 : 1} strokeWidth={1 / viewport.zoom} />)
    }
  }

  return (
    <>
      <Rect x={startX} y={startY} width={endX - startX} height={endY - startY} fill={backgroundFill} />
      {lines}
    </>
  )
}

function ImageNode({
  imageObject,
  selected,
  movable,
  onImageLoad,
  onSelect,
  onMoveStart,
}: {
  imageObject: CanvasImage
  selected: boolean
  movable: boolean
  onImageLoad: (image: HTMLImageElement) => void
  onSelect: () => void
  onMoveStart: (event: Konva.KonvaEventObject<PointerEvent>) => void
}) {
  const image = useHtmlImage(imageObject.src, onImageLoad)

  return (
    <Group
      name="canvas-object"
      objectId={imageObject.id}
      x={imageObject.x}
      y={imageObject.y}
      draggable={false}
      onPointerDown={(event) => {
        if (movable) {
          event.cancelBubble = true
          onSelect()
          onMoveStart(event)
        }
      }}
      onClick={onSelect}
      onTap={onSelect}
    >
      <KonvaImage image={image ?? undefined} width={imageObject.width} height={imageObject.height} shadowColor="#101828" shadowOpacity={0.1} shadowBlur={12} />
      {selected ? <Rect width={imageObject.width} height={imageObject.height} stroke="#2671ff" strokeWidth={2} dash={[8, 5]} listening={false} /> : null}
    </Group>
  )
}

function AnnotationNode({
  annotation,
  annotationNumber,
  selected,
  editing,
  editingText,
  draggable,
  onSelect,
  onEdit,
}: {
  annotation: Annotation
  annotationNumber?: string
  selected: boolean
  editing: boolean
  editingText?: Annotation['text']
  draggable: boolean
  onSelect: () => void
  onEdit: () => void
}) {
  const numberMetrics = annotationNumber ? getCalloutNumberMetrics(annotation.style) : null
  const numberSize = numberMetrics?.size ?? 0
  const numberRadius = numberMetrics?.radius ?? 0
  const numberPosition = annotationNumber ? getCalloutNumberPosition(annotation.text, annotation.style) : null
  const textInset = annotationNumber ? getCalloutTextInset(annotation.style) : 0
  const arrowEnd = editing && editingText ? getArrowTailForAnchor(editingText, { x: annotation.arrow.startX, y: annotation.arrow.startY }) : { x: annotation.arrow.endX, y: annotation.arrow.endY }
  const textX = annotation.text.x + annotation.style.boxPadding + textInset
  const textY = annotation.text.y + annotation.style.boxPadding + annotation.style.fontSize * 0.12
  const textWidth = Math.max(24, annotation.text.width - annotation.style.boxPadding * 2 - textInset)
  const textHeight = Math.max(24, annotation.text.height - annotation.style.boxPadding * 2)
  const selectionBounds = getAnnotationBounds(annotation, Boolean(annotationNumber))
  const { minX, minY, maxX, maxY } = selectionBounds

  return (
    <Group
      name="canvas-object"
      objectId={annotation.id}
      draggable={draggable}
      onClick={(event) => {
        event.cancelBubble = true
        onSelect()
      }}
      onTap={(event) => {
        event.cancelBubble = true
        onSelect()
      }}
      onDblClick={(event) => {
        event.cancelBubble = true
        onEdit()
      }}
      onDblTap={(event) => {
        event.cancelBubble = true
        onEdit()
      }}
    >
      <FloatingArrow
        points={[arrowEnd.x, arrowEnd.y, annotation.arrow.startX, annotation.arrow.startY]}
        style={annotation.style}
      />
      {!editing ? (
        <>
          <Rect
            x={annotation.text.x}
            y={annotation.text.y}
            width={annotation.text.width}
            height={annotation.text.height}
            fill={annotation.style.boxBackgroundColor}
            opacity={annotation.style.boxOpacity}
            stroke={annotation.style.boxBorderColor}
            strokeWidth={annotation.style.boxBorderWidth}
            cornerRadius={annotation.style.boxBorderRadius}
            shadowColor="#101828"
            shadowOpacity={0.08}
            shadowBlur={10}
          />
          {annotationNumber && numberPosition ? (
            <CalloutNumberCanvas
              x={numberPosition.x}
              y={numberPosition.y}
              size={numberSize}
              radius={numberRadius}
              fontSize={numberMetrics?.fontSize ?? annotation.style.fontSize}
              value={annotationNumber}
            />
          ) : null}
          <Text
            x={textX}
            y={textY}
            width={textWidth}
            height={textHeight}
            text={annotation.text.content || '输入批注'}
            fontSize={annotation.style.fontSize}
            fontStyle={String(normalizeFontWeight(annotation.style.fontWeight))}
            fill={annotation.text.content ? annotation.style.textColor : '#d48a8a'}
            stroke={annotation.text.content ? annotation.style.textColor : undefined}
            strokeWidth={annotation.text.content ? getTextStrokeWidth(normalizeFontWeight(annotation.style.fontWeight)) : 0}
            lineHeight={1.35}
            verticalAlign="middle"
          />
        </>
      ) : null}
      {selected && !editing ? <Rect x={minX - 8} y={minY - 8} width={maxX - minX + 16} height={maxY - minY + 16} stroke="#2671ff" strokeWidth={2} dash={[8, 5]} listening={false} /> : null}
    </Group>
  )
}

function roundedRectPath(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const safeRadius = Math.min(radius, width / 2, height / 2)
  context.beginPath()
  context.moveTo(x + safeRadius, y)
  context.lineTo(x + width - safeRadius, y)
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius)
  context.lineTo(x + width, y + height - safeRadius)
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height)
  context.lineTo(x + safeRadius, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius)
  context.lineTo(x, y + safeRadius)
  context.quadraticCurveTo(x, y, x + safeRadius, y)
  context.closePath()
}

function getGlyphCenterOffset(value: string, fontSize: number, font: string) {
  const scale = 3
  const canvasSize = Math.ceil(fontSize * 2.4 * scale)
  const center = canvasSize / 2
  const canvas = document.createElement('canvas')
  canvas.width = canvasSize
  canvas.height = canvasSize
  const context = canvas.getContext('2d')
  if (!context) return { x: 0, y: 0 }

  context.scale(scale, scale)
  context.font = font
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillStyle = '#ffffff'
  context.fillText(value, canvasSize / scale / 2, canvasSize / scale / 2)

  const pixels = context.getImageData(0, 0, canvasSize, canvasSize).data
  let minX = canvasSize
  let minY = canvasSize
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < canvasSize; y += 1) {
    for (let x = 0; x < canvasSize; x += 1) {
      if (pixels[(y * canvasSize + x) * 4 + 3] < 24) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  if (maxX < 0 || maxY < 0) return { x: 0, y: 0 }

  return {
    x: (center - (minX + maxX) / 2) / scale,
    y: (center - (minY + maxY) / 2) / scale,
  }
}

function drawCalloutNumberButton(context: CanvasRenderingContext2D, size: number, radius: number, fontSize: number, value: string, withShadow: boolean) {
  const outerGradient = context.createLinearGradient(0, 0, 0, size)
  outerGradient.addColorStop(0, '#d51600')
  outerGradient.addColorStop(0.2, '#ff6500')
  outerGradient.addColorStop(0.72, '#e52b00')
  outerGradient.addColorStop(1, '#980f00')

  context.save()
  if (withShadow) {
    context.shadowColor = 'rgba(111, 30, 0, 0.42)'
    context.shadowBlur = 14
    context.shadowOffsetX = 3.5
    context.shadowOffsetY = 4.5
  }
  roundedRectPath(context, 0, 0, size, size, radius)
  context.fillStyle = outerGradient
  context.fill()
  context.restore()

  const innerInset = size * 0.075
  const innerSize = size * 0.85
  const innerGradient = context.createLinearGradient(0, innerInset, 0, innerInset + innerSize)
  innerGradient.addColorStop(0, '#ff8a22')
  innerGradient.addColorStop(0.46, '#ff4a00')
  innerGradient.addColorStop(1, '#ff2e00')
  roundedRectPath(context, innerInset, innerInset, innerSize, innerSize, Math.max(5, radius - size * 0.05))
  context.fillStyle = innerGradient
  context.fill()
  context.strokeStyle = '#ff6b00'
  context.lineWidth = 1.6
  context.stroke()

  const highlightInset = size * 0.14
  const highlightSize = size * 0.72
  roundedRectPath(context, highlightInset, highlightInset, highlightSize, highlightSize, Math.max(4, radius - size * 0.11))
  context.strokeStyle = 'rgba(255, 210, 122, 0.86)'
  context.lineWidth = 1.5
  context.stroke()

  const bottomGradient = context.createLinearGradient(0, size * 0.66, 0, size * 0.86)
  bottomGradient.addColorStop(0, 'rgba(143, 18, 0, 0)')
  bottomGradient.addColorStop(1, 'rgba(143, 18, 0, 0.28)')
  roundedRectPath(context, size * 0.1, size * 0.66, size * 0.8, size * 0.2, Math.max(3, radius - size * 0.12))
  context.fillStyle = bottomGradient
  context.fill()

  context.save()
  const fontFamily = '"Arial Black", Impact, "Microsoft YaHei UI", "Microsoft YaHei", sans-serif'
  let fittedFontSize = fontSize
  const maxGlyphWidth = size * 0.64
  for (let attempts = 0; attempts < 8; attempts += 1) {
    context.font = `900 ${fittedFontSize}px ${fontFamily}`
    if (context.measureText(value).width <= maxGlyphWidth || fittedFontSize <= size * 0.42) break
    fittedFontSize *= 0.88
  }
  const font = `900 ${fittedFontSize}px ${fontFamily}`
  const offset = getGlyphCenterOffset(value, fittedFontSize, font)
  const textX = size / 2 + offset.x - (value === '1' ? size * 0.045 : 0)
  const textY = size / 2 + offset.y
  context.font = font
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.shadowColor = 'rgba(139, 43, 0, 0.42)'
  context.shadowBlur = 3
  context.shadowOffsetY = 1.5
  context.lineWidth = 0.35
  context.strokeStyle = '#ffffff'
  context.fillStyle = '#ffffff'
  context.strokeText(value, textX, textY)
  context.fillText(value, textX, textY)
  context.restore()
}

function CalloutNumberHtmlCanvas({
  size,
  logicalSize,
  radius,
  fontSize,
  value,
}: {
  size: number
  logicalSize: number
  radius: number
  fontSize: number
  value: string
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.round(size * ratio))
    canvas.height = Math.max(1, Math.round(size * ratio))
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`
    context.setTransform((size / logicalSize) * ratio, 0, 0, (size / logicalSize) * ratio, 0, 0)
    context.clearRect(0, 0, logicalSize, logicalSize)
    drawCalloutNumberButton(context, logicalSize, radius, fontSize, value, false)
  }, [fontSize, logicalSize, radius, size, value])

  return <canvas ref={canvasRef} className="annotation-editor-number-canvas" aria-hidden="true" />
}

function CalloutNumberCanvas({
  x,
  y,
  size,
  radius,
  fontSize,
  value,
}: {
  x: number
  y: number
  size: number
  radius: number
  fontSize: number
  value: string
}) {
  return (
    <Shape
      x={x}
      y={y}
      width={size}
      height={size}
      listening={false}
      sceneFunc={(context) => {
        const canvasContext = (context as unknown as { _context: CanvasRenderingContext2D })._context
        drawCalloutNumberButton(canvasContext, size, radius, fontSize, value, true)
      }}
    />
  )
}

function FloatingArrow({
  points,
  style,
  listening = true,
}: {
  points: number[]
  style: AnnotationStyle
  listening?: boolean
}) {
  const mainColor = style.arrowAutoContrast ? (style.computedArrowColor ?? '#000000') : style.arrowColor
  const haloColor = getArrowHaloColor(mainColor)
  const haloOpacity = style.arrowAutoContrast ? 0.9 : 0.5
  const shadowWidth = style.arrowWidth + 8
  const haloWidth = style.arrowWidth + 5
  const pointerLength = Math.max(12, style.arrowWidth * 4)
  const pointerWidth = Math.max(12, style.arrowWidth * 4)

  return (
    <Group listening={listening}>
      <Arrow
        points={points.map((value, index) => value + (index % 2 === 0 ? 3 : 4))}
        stroke="#101828"
        fill="#101828"
        opacity={0.32}
        strokeWidth={shadowWidth}
        pointerLength={pointerLength}
        pointerWidth={pointerWidth}
        lineCap="round"
        lineJoin="round"
      />
      <Arrow
        points={points}
        stroke={haloColor}
        fill={haloColor}
        opacity={haloOpacity}
        strokeWidth={haloWidth}
        pointerLength={pointerLength}
        pointerWidth={pointerWidth}
        lineCap="round"
        lineJoin="round"
      />
      <Arrow
        points={points}
        stroke={mainColor}
        fill={mainColor}
        strokeWidth={style.arrowWidth}
        pointerLength={pointerLength}
        pointerWidth={pointerWidth}
        shadowColor="#101828"
        shadowBlur={8}
        shadowOffsetX={2}
        shadowOffsetY={3}
        shadowOpacity={0.28}
        lineCap="round"
        lineJoin="round"
      />
      <Arrow
        points={points.map((value) => value - 1)}
        stroke="#ffffff"
        fill="#ffffff"
        opacity={mainColor === '#ffffff' ? 0.25 : 0.42}
        strokeWidth={Math.max(1, style.arrowWidth * 0.34)}
        pointerLength={pointerLength}
        pointerWidth={pointerWidth}
        lineCap="round"
        lineJoin="round"
      />
    </Group>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
