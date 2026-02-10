import sys
from faster_whisper import WhisperModel

if len(sys.argv) != 2:
    print('Usage: transcribe.py <audio_path>', file=sys.stderr)
    sys.exit(1)

audio_path = sys.argv[1]
model = WhisperModel('small', device='cpu', compute_type='int8')
segments, _ = model.transcribe(audio_path)
text = ' '.join(segment.text.strip() for segment in segments).strip()
print(text)
