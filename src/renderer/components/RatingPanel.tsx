import { useState, useEffect } from 'react'

type RatingData = {
  score: number
  tags: string[]
  note?: string
}

type Props = {
  providerResultId: string
  onSave: (input: { providerResultId: string; score: number; tags: string[]; note?: string }) => Promise<boolean>
  initialRating?: RatingData
}

export default function RatingPanel({ providerResultId, onSave, initialRating }: Props) {
  const [score, setScore] = useState(initialRating?.score ?? 0)
  const [tagsText, setTagsText] = useState(initialRating?.tags.join(', ') ?? '')
  const [note, setNote] = useState(initialRating?.note ?? '')
  const [saved, setSaved] = useState(!!initialRating)
  const [saving, setSaving] = useState(false)

  // Reset when switching between results (e.g. history navigation)
  useEffect(() => {
    setScore(initialRating?.score ?? 0)
    setTagsText(initialRating?.tags.join(', ') ?? '')
    setNote(initialRating?.note ?? '')
    setSaved(!!initialRating)
  }, [providerResultId])

  async function handleSave() {
    if (score === 0) return
    setSaving(true)
    const tags = tagsText
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
    const ok = await onSave({ providerResultId, score, tags, note: note.trim() || undefined })
    setSaving(false)
    if (ok) setSaved(true)
  }

  return (
    <div className="rating-panel">
      <div className="rating-stars">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            className={`star ${n <= score ? 'active' : ''}`}
            onClick={() => { setScore(n); setSaved(false) }}
          >
            {n <= score ? '\u2605' : '\u2606'}
          </button>
        ))}
      </div>
      <input
        className="rating-tags"
        type="text"
        placeholder="Tags (comma-separated)"
        value={tagsText}
        onChange={(e) => { setTagsText(e.target.value); setSaved(false) }}
      />
      <input
        className="rating-note"
        type="text"
        placeholder="Note (optional)"
        value={note}
        onChange={(e) => { setNote(e.target.value); setSaved(false) }}
      />
      <button
        className="rating-save"
        onClick={handleSave}
        disabled={score === 0 || saving}
      >
        {saving ? 'Saving...' : saved ? 'Saved' : 'Save Rating'}
      </button>
    </div>
  )
}
