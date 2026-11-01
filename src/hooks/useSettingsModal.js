import { useEffect, useState } from 'react'
import useStore from '../store/useStore'
import { resolveApiBase, getModelLists, getNodeComboOptions, checkNodes } from '../lib/comfyui'
import { fetchLlmModels, PROVIDERS } from '../lib/llm'
import { configFromState, pushRuntimeConfig, fetchRuntimeConfig, QUALITY_PRESETS } from '../lib/config'
import { requiredThreeDNodes } from '../lib/threed'

const EMPTY_LISTS = {
  unet: [],
  clip: [],
  vae: [],
  lora: [],
  gguf: [],
  checkpoint: [],
  upscale: [],
}

const EMPTY_THREE_D_LISTS = {
  modelVersion: [],
  rigVersion: [],
  rigType: [],
  spec: [],
  outFormat: [],
  presets: [],
  localAnims: [],
  upscaleModels: [],
  ultrashapeCkpts: [],
}

const draftFor = (state, mode) => ({
  unet: '',
  clip: '',
  vae: '',
  lora: '',
  ...(state.presets?.[mode]?.[state.active?.[mode]] || state.models?.[mode] || {}),
})

// Owns every editable copy shown by the settings modal: the modal never writes
// to the store until Save, so a half-finished edit (or a failed push to
// config.json) can't silently change what generation uses.
export default function useSettingsModal() {
  const showSettings = useStore((s) => s.showSettings)
  const setShowSettings = useStore((s) => s.setShowSettings)

  const serverUrl = useStore((s) => s.serverUrl)
  const setServerUrl = useStore((s) => s.setServerUrl)
  const applyServerConfig = useStore((s) => s.applyServerConfig)
  const models = useStore((s) => s.models)
  const setModels = useStore((s) => s.setModels)
  const useProxy = useStore((s) => s.useProxy)
  const setUseProxy = useStore((s) => s.setUseProxy)
  const autoUnload = useStore((s) => s.autoUnload)
  const setAutoUnload = useStore((s) => s.setAutoUnload)
  const vramGuard = useStore((s) => s.vramGuard)
  const setVramGuard = useStore((s) => s.setVramGuard)
  const modelsUnloaded = useStore((s) => s.modelsUnloaded)
  const presets = useStore((s) => s.presets)
  const active = useStore((s) => s.active)
  const updatePreset = useStore((s) => s.updatePreset)

  const llmProvider = useStore((s) => s.llmProvider)
  const llmConfigs = useStore((s) => s.llmConfigs)
  const setLlmProvider = useStore((s) => s.setLlmProvider)
  const setLlmConfigs = useStore((s) => s.setLlmConfigs)

  const searchUrl = useStore((s) => s.searchUrl)
  const setSearchUrl = useStore((s) => s.setSearchUrl)
  const searchEngine = useStore((s) => s.searchEngine)
  const setSearchEngine = useStore((s) => s.setSearchEngine)
  const searchApiKey = useStore((s) => s.searchApiKey)
  const setSearchApiKey = useStore((s) => s.setSearchApiKey)
  const searchCseId = useStore((s) => s.searchCseId)
  const setSearchCseId = useStore((s) => s.setSearchCseId)

  const threeD = useStore((s) => s.threeD)
  const setThreeD = useStore((s) => s.setThreeD)

  const [tab, setTab] = useState('server')
  const [localUrl, setLocalUrl] = useState(serverUrl)
  const [localModels, setLocalModels] = useState(() => JSON.parse(JSON.stringify(models)))
  const [editDraft, setEditDraft] = useState(() => draftFor(useStore.getState(), 'music'))
  const [videoDraft, setVideoDraft] = useState(() => draftFor(useStore.getState(), 'video'))
  const [sfxDraft, setSfxDraft] = useState(() => draftFor(useStore.getState(), 'sfx'))
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [pulling, setPulling] = useState(false)
  const [pullNote, setPullNote] = useState(null)
  const [modelLists, setModelLists] = useState(EMPTY_LISTS)
  const [loadingLists, setLoadingLists] = useState(false)
  const [listsError, setListsError] = useState(null)

  const [localProvider, setLocalProvider] = useState(llmProvider)
  const [localConfigs, setLocalConfigs] = useState(llmConfigs)
  const [llmModels, setLlmModels] = useState([])
  const [loadingLlmModels, setLoadingLlmModels] = useState(false)
  const [llmModelsError, setLlmModelsError] = useState(null)

  const [localSearchUrl, setLocalSearchUrl] = useState(searchUrl)
  const [localSearchEngine, setLocalSearchEngine] = useState(searchEngine)
  const [localSearchApiKey, setLocalSearchApiKey] = useState(searchApiKey)
  const [localSearchCseId, setLocalSearchCseId] = useState(searchCseId)

  // Seed from the store, filling any quality fields an older saved config
  // predates (localStorage from a previous build may lack them).
  const [localThreeD, setLocalThreeD] = useState({
    qualityPreset: 'standard',
    meshMode: 'pixal3d',
    ...QUALITY_PRESETS.standard,
    ...threeD,
  })
  const [threeDLists, setThreeDLists] = useState(EMPTY_THREE_D_LISTS)
  // Result of the last "does the server have the required 3D nodes?" check:
  // null = not checked, { ok } | { missing, unreachable, busy }
  const [threeDCheck, setThreeDCheck] = useState(null)
  const [threeDChecking, setThreeDChecking] = useState(false)

  const setLocalConfig = (provider, patch) =>
    setLocalConfigs((c) => ({ ...c, [provider]: { ...c[provider], ...patch } }))

  const loadModelLists = async (url) => {
    setLoadingLists(true)
    setListsError(null)
    try {
      const base = resolveApiBase(url, useProxy)
      const lists = await getModelLists(base)
      setModelLists({ ...EMPTY_LISTS, ...lists })
      if (Object.values(lists).every((l) => l.length === 0)) {
        setListsError('Server responded but reported no model files — are your models downloaded?')
      }
    } catch (err) {
      setListsError(`Could not reach server: ${err.message}`)
    } finally {
      setLoadingLists(false)
    }
  }

  const loadLlmModels = async (url) => {
    setLoadingLlmModels(true)
    setLlmModelsError(null)
    try {
      const names = await fetchLlmModels(url)
      setLlmModels(names)
      if (names.length === 0) setLlmModelsError('Endpoint is reachable but listed no models.')
    } catch (err) {
      setLlmModels([])
      setLlmModelsError(err.message)
    } finally {
      setLoadingLlmModels(false)
    }
  }

  // Combo options for the 3D nodes, straight from the ComfyUI server.
  const loadThreeDLists = async (url) => {
    try {
      const base = resolveApiBase(url, useProxy)
      const [modelVersion, rigVersion, rigType, spec, outFormat, presets, localAnims, upscaleModels, ultrashapeCkpts] =
        await Promise.all([
          getNodeComboOptions(base, 'TripoImageToModelNode', 'model_version', 'optional'),
          getNodeComboOptions(base, 'TripoRigNode', 'model_version', 'optional'),
          getNodeComboOptions(base, 'TripoRigNode', 'rig_type', 'optional'),
          getNodeComboOptions(base, 'TripoRigNode', 'spec', 'optional'),
          getNodeComboOptions(base, 'TripoRigNode', 'out_format', 'optional'),
          getNodeComboOptions(base, 'TripoRetargetNode', 'animation', 'required'),
          getNodeComboOptions(base, 'UniRigApplyAnimation', 'animation_file', 'required'),
          getNodeComboOptions(base, 'UpscaleModelLoader', 'model_name', 'required'),
          getNodeComboOptions(base, 'UltraShapeLoadModel', 'checkpoint', 'required'),
        ])
      setThreeDLists({
        modelVersion,
        rigVersion,
        rigType,
        spec,
        outFormat,
        presets,
        localAnims,
        upscaleModels,
        ultrashapeCkpts: ultrashapeCkpts.filter((c) => c !== '(select file)'),
      })
    } catch {
      // server unreachable — selects fall back to the saved values
    }
  }

  // "Does the server actually have this pipeline's node packs?" — run when the
  // 3D tab is switched on, when the pipeline changes, and again on Save.
  // Never throws; resolves { ok: true } | { ok: false, missing, unreachable, busy }.
  const verifyThreeD = async (pipeline, url = localUrl) => {
    setThreeDChecking(true)
    try {
      const base = resolveApiBase(url, useProxy)
      const { missing, unreachable, busy: serverBusy } = await checkNodes(base, requiredThreeDNodes(pipeline))
      const check =
        missing.length > 0
          ? { ok: false, missing, unreachable: false, busy: false }
          : unreachable
            ? { ok: false, missing: [], unreachable: true, busy: false }
            : serverBusy
              ? { ok: false, missing: [], unreachable: false, busy: true }
              : { ok: true, missing: [] }
      setThreeDCheck(check)
      return check
    } catch (err) {
      const check = { ok: false, missing: [], unreachable: true, error: err.message }
      setThreeDCheck(check)
      return check
    } finally {
      setThreeDChecking(false)
    }
  }

  // Enabling requires a verified server: missing packs keep the tab off and
  // surface an install hint. An unreachable server only warns (can't verify).
  const toggleThreeD = async () => {
    if (localThreeD.enabled) {
      setLocalThreeD((t) => ({ ...t, enabled: false }))
      setThreeDCheck(null)
      return
    }
    const check = await verifyThreeD(localThreeD.pipeline)
    if (check.missing?.length > 0) return
    setLocalThreeD((t) => ({ ...t, enabled: true }))
  }

  const changePipeline = async (v) => {
    const wasEnabled = localThreeD.enabled
    setLocalThreeD((t) => ({ ...t, pipeline: v }))
    if (!wasEnabled) return
    const check = await verifyThreeD(v)
    if (check.missing?.length > 0) setLocalThreeD((t) => ({ ...t, enabled: false }))
  }

  // Switching provider clears the previous endpoint's model list and, when the
  // new provider can enumerate models (LM Studio / OpenAI-compatible), loads
  // them straight away.
  const changeProvider = (p) => {
    setLocalProvider(p)
    setLlmModels([])
    setLlmModelsError(null)
    if (PROVIDERS[p]?.modelsBtn && localConfigs[p]?.url) loadLlmModels(localConfigs[p].url)
  }

  // Refresh local fields + server model lists each time the modal opens.
  // Reads straight from the store (getState) so it can also re-seed right
  // after a pull from the server, before React re-renders with new props.
  const seedFromStore = () => {
    const st = useStore.getState()
    setLocalUrl(st.serverUrl)
    const current = JSON.parse(JSON.stringify(st.models))
    setLocalModels({
      ...current,
      edit: {
        unet: 'qwen_image_edit_fp8_e4m3fn.safetensors',
        ...(current.edit || {}),
      },
    })
    setEditDraft(draftFor(st, 'music'))
    setVideoDraft(draftFor(st, 'video'))
    setSfxDraft(draftFor(st, 'sfx'))
    loadModelLists(st.serverUrl)
    setLocalProvider(st.llmProvider)
    const cfgs = JSON.parse(JSON.stringify(st.llmConfigs))
    setLocalConfigs(cfgs)
    setLlmModels([])
    setLlmModelsError(null)
    if (PROVIDERS[st.llmProvider]?.modelsBtn && cfgs[st.llmProvider]?.url) {
      loadLlmModels(cfgs[st.llmProvider].url)
    }
    setLocalSearchUrl(st.searchUrl)
    setLocalSearchEngine(st.searchEngine || 'searxng')
    setLocalSearchApiKey(st.searchApiKey || '')
    setLocalSearchCseId(st.searchCseId || '')
    setLocalThreeD({
      qualityPreset: 'standard',
      ...QUALITY_PRESETS.standard,
      ...JSON.parse(JSON.stringify(st.threeD)),
    })
    setThreeDCheck(null)
    setThreeDLists(EMPTY_THREE_D_LISTS)
  }

  useEffect(() => {
    if (!showSettings) return
    setTab('server')
    setSaveError(null)
    setPullNote(null)
    seedFromStore()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSettings])

  // Re-seed the editable drafts whenever the selected preset changes, so the
  // fields never show a different preset's files than the ticked row.
  useEffect(() => {
    const st = useStore.getState()
    setEditDraft(draftFor(st, 'music'))
    setVideoDraft(draftFor(st, 'video'))
    setSfxDraft(draftFor(st, 'sfx'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.music, active?.video, active?.sfx, presets])

  // Esc closes the modal (same as the X button in the header).
  useEffect(() => {
    if (!showSettings) return
    const onKey = (e) => {
      if (e.key === 'Escape') setShowSettings(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showSettings, setShowSettings])

  // Fetch 3D node option lists whenever the section is open and enabled. Uses
  // the URL currently typed in the modal (not the saved one) so toggling the
  // tab after editing the server address queries the right server.
  useEffect(() => {
    if (showSettings && localThreeD.enabled) loadThreeDLists(localUrl)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSettings, localThreeD.enabled, localUrl, useProxy])

  // "Update from server" — pull config.json (shared settings saved by any
  // device via Save Settings) and apply it on demand, re-seeding the open
  // modal so the fields show the pulled values immediately.
  const handlePull = async () => {
    if (pulling) return
    setPulling(true)
    setPullNote(null)
    setSaveError(null)
    try {
      const config = await fetchRuntimeConfig()
      if (!config || Object.keys(config).length === 0) {
        setPullNote({ kind: 'warn', text: 'No settings found on the server (or it is unreachable) — nothing to update.' })
        return
      }
      if (config.synced !== true) {
        setPullNote({ kind: 'warn', text: 'Server has no saved settings yet — press Save Settings on a device first.' })
        return
      }
      applyServerConfig(config, { force: true })
      seedFromStore()
      setPullNote({ kind: 'ok', text: 'Settings updated from the server.' })
      setTimeout(() => setPullNote(null), 4000)
    } catch (err) {
      setPullNote({ kind: 'warn', text: `Could not read settings from the server: ${err.message}` })
    } finally {
      setPulling(false)
    }
  }

  const handleSave = async () => {
    // Final gate for the 3D tab: never persist "enabled" on a server that
    // is missing the required node packs.
    if (localThreeD.enabled) {
      const check = await verifyThreeD(localThreeD.pipeline)
      if (check.missing?.length > 0) {
        setSaveError('3D tab not enabled — required node pack(s) missing on the server (see 3D Generation above).')
        return
      }
    }
    setServerUrl(localUrl)
    setModels('image', localModels.image)
    setModels('video', localModels.video)
    if (localModels.edit) setModels('edit', localModels.edit)
    if (localModels.music) setModels('music', localModels.music)
    if (localModels.sfx) setModels('sfx', localModels.sfx)
    if (localModels.character) setModels('character', localModels.character)
    // Write the edited model files back into the selected preset so the picker
    // and generation both see the change.
    if (active?.music != null && presets?.music?.[active.music]) {
      updatePreset('music', active.music, { ...editDraft })
    }
    if (active?.sfx != null && presets?.sfx?.[active.sfx]) {
      updatePreset('sfx', active.sfx, { ...sfxDraft })
    }
    if (active?.video != null && presets?.video?.[active.video]) {
      updatePreset('video', active.video, { ...videoDraft })
    }
    setLlmProvider(localProvider)
    setLlmConfigs(localConfigs)
    setSearchUrl(localSearchUrl)
    setSearchEngine(localSearchEngine)
    setSearchApiKey(localSearchApiKey)
    setSearchCseId(localSearchCseId)
    setThreeD(localThreeD)
    // Write through to config.json on disk so every browser shares these
    // settings (keys are excluded — they stay in this browser).
    setSaveError(null)
    try {
      await pushRuntimeConfig(configFromState(useStore.getState()))
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setSaveError(err.message)
    }
  }

  return {
    showSettings,
    setShowSettings,
    tab,
    setTab,
    saved,
    saveError,
    pullNote,
    pulling,
    handlePull,
    handleSave,
    // server
    useProxy,
    setUseProxy,
    autoUnload,
    setAutoUnload,
    vramGuard,
    setVramGuard,
    modelsUnloaded,
    localUrl,
    setLocalUrl,
    // models
    modelLists,
    loadModelLists,
    loadingLists,
    listsError,
    localModels,
    setLocalModels,
    editDraft,
    setEditDraft,
    videoDraft,
    setVideoDraft,
    sfxDraft,
    setSfxDraft,
    // llm
    localProvider,
    setLocalProvider,
    changeProvider,
    localConfigs,
    setLocalConfig,
    llmModels,
    loadLlmModels,
    loadingLlmModels,
    llmModelsError,
    // search
    localSearchUrl,
    setLocalSearchUrl,
    localSearchEngine,
    setLocalSearchEngine,
    localSearchApiKey,
    setLocalSearchApiKey,
    localSearchCseId,
    setLocalSearchCseId,
    // 3d
    localThreeD,
    setLocalThreeD,
    threeDCheck,
    threeDChecking,
    toggleThreeD,
    changePipeline,
    threeDLists,
  }
}
