import { Globe } from 'lucide-react'
import { SEARCH_ENGINES, searchEngineInfo } from '../../lib/search'
import { SectionTitle, Note, TextField, SelectField } from './fields'

export default function SearchSection({
  localSearchEngine,
  setLocalSearchEngine,
  localSearchUrl,
  setLocalSearchUrl,
  localSearchApiKey,
  setLocalSearchApiKey,
  localSearchCseId,
  setLocalSearchCseId,
}) {
  const info = searchEngineInfo(localSearchEngine)

  return (
    <div className="space-y-3">
      <SectionTitle icon={Globe} title="Web Image Search" />

      <SelectField
        label="Search engine"
        value={localSearchEngine}
        onChange={setLocalSearchEngine}
        options={SEARCH_ENGINES.map((e) => [e.value, e.label])}
      />

      <p className="text-[11px] leading-relaxed text-text-muted">
        {info.hint}
        {info.docs && (
          <>
            {' '}
            <a href={info.docs} target="_blank" rel="noreferrer" className="text-sky-300 hover:underline">
              Get one →
            </a>
          </>
        )}
      </p>

      {info.needsUrl && (
        <TextField
          label="SearXNG URL"
          value={localSearchUrl}
          onChange={setLocalSearchUrl}
          placeholder="https://searx.example.com"
        />
      )}
      {info.needsKey && (
        <TextField
          label="API key"
          type="password"
          value={localSearchApiKey}
          onChange={setLocalSearchApiKey}
          placeholder="paste your API key"
        />
      )}
      {info.needsCse && (
        <TextField
          label="Search Engine ID (cx)"
          value={localSearchCseId}
          onChange={setLocalSearchCseId}
          placeholder="0123456789abcdef:abcdefghijk"
        />
      )}

      <Note>
        Powers the <span className="font-medium text-sky-300">Web</span> button: search the internet for a reference
        image, click one, and it becomes the Edit source for ComfyUI to update. Requests go through the app proxy —
        no CORS issues, self-signed certs fine.
        {localSearchEngine === 'searxng' && (
          <>
            {' '}
            Your instance must have <span className="font-mono">json</span> listed under{' '}
            <span className="font-mono">search.formats</span> in settings.yml.
          </>
        )}
        {info.needsKey && (
          <>
            {' '}
            The key stays in this browser — it is never written to the shared config.
          </>
        )}
      </Note>
    </div>
  )
}
