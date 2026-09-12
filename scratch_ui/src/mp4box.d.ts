declare module 'mp4box' {
  export interface MP4File {
    onReady?: (info: any) => void;
    onError?: (e: string) => void;
    onSamples?: (id: number, user: any, samples: any[]) => void;
    appendBuffer(data: ArrayBuffer): number;
    start(): void;
    stop(): void;
    flush(): void;
    setExtractionOptions(id: number, user: any, options?: any): void;
  }

  export function createFile(): MP4File;
  export const Log: {
    setLogLevel(level: (i: any) => void): void;
  };
}
