// The 3D preview's mesh worker: parses STL, OBJ and 3MF files and finds normals, bounds and
// edges for every format, so large models don't freeze the page. The page terminates it to cancel.
import { handleMeshRequest } from './viewer-mesh';
import type { MeshRequest } from './viewer-protocol';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<MeshRequest>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
};

scope.onmessage = (event) => {
  const { reply, transfer } = handleMeshRequest(event.data);
  scope.postMessage(reply, transfer);
};
