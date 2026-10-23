type ErrorSource = Pick<NodeJS.WritableStream, 'on'>;

export function ignoreBrokenPipes(streams: readonly ErrorSource[]): void {
  for (const stream of streams) {
    stream.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE' && error.code !== 'EIO') throw error;
    });
  }
}
