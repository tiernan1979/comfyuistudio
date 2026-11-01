export const COLORS = ['#818cf8', '#34d399', '#f472b6', '#fbbf24', '#60a5fa', '#a78bfa', '#2dd4bf', '#fb923c']

export const STEM_DEFS = [
  { key: 'drums', name: 'Drums', color: '#fb923c' },
  { key: 'bass', name: 'Bass', color: '#f472b6' },
  { key: 'vocals', name: 'Vocals', color: '#34d399' },
  { key: 'synth', name: 'Synth', color: '#60a5fa' },
]

// AI part presets — production-grade captions (the model sings from bare
// prompts like "dum dum dum" unless the caption is this explicit).
export const PART_PRESETS = [
  {
    label: 'Bassline',
    caption:
      'A groovy electric bass guitar bassline in A minor at 110 BPM, syncopated funk riff with ghost notes, round warm low end, tight palm-muted attacks, four-bar phrase that loops seamlessly',
  },
  {
    label: 'Drums',
    caption:
      'An acoustic drum kit groove at 96 BPM, punchy kick, crisp snare on beats 2 and 4, steady closed hi-hat eighths, dry studio room sound, tight human feel, four-bar loop',
  },
  {
    label: 'Guitar',
    caption:
      'A clean electric guitar riff at 120 BPM, bright chimey tone with light reverb, rhythmic 16th-note picking pattern, mellow indie-pop feel, four-bar loop',
  },
  {
    label: 'Keys',
    caption:
      'Warm Rhodes electric piano chords at 84 BPM, jazzy seventh voicings, soft tremolo, mellow lo-fi character, four-bar progression that loops seamlessly',
  },
  {
    label: 'Pad',
    caption:
      'A wide evolving ambient synth pad at 70 BPM, lush detuned saw layers, slow filter swell, spacious reverb tail, atmospheric texture bed',
  },
  {
    label: 'Lead',
    caption:
      'A gliding analog lead synthesizer melody at 124 BPM, portamento between notes, saw and square wave layers, catchy hooky phrase in A minor, four-bar loop',
  },
  {
    label: 'Strings',
    caption:
      'Orchestral string section stabs at 110 BPM, short accented hits with natural hall reverb, dramatic cinematic motif, four-bar pattern',
  },
  {
    label: 'Percussion',
    caption:
      'A crisp 16th-note hi-hat and shaker percussion layer at 128 BPM, closed hats with subtle velocity variation and swing, tight electronic groove, seamless loop',
  },
]

export const HEADER_W = 176
export const LANE_H = 64
