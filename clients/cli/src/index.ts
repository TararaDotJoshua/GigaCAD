import { run } from './cli.js';
import { processContext } from './context.js';

// Output piped into something that exits early (`giga ... | head`) is not an error.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') process.exit(process.exitCode ?? 0);
    throw error;
  });
}

process.exitCode = await run(process.argv.slice(2), processContext());
