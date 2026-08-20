/** ASR（语音识别）提供商抽象 */
export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface Transcript {
  text: string;
  segments: TranscriptSegment[];
  language?: string;
}

export interface AsrOptions {
  signal?: AbortSignal;
}

export interface AsrProvider {
  readonly id: string;
  readonly label: string;
  transcribe(samples: number[] | Float32Array, sampleRate: number, opts?: AsrOptions): Promise<Transcript>;
  healthCheck(): Promise<{ ok: boolean; message?: string }>;
}