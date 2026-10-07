import { VaultAccessError } from '@atlas/application';

/**
 * Tauri rejects with the plain string a command returned in `Err`. Turn that into
 * a real Error at the boundary so nothing downstream has to handle both shapes.
 *
 * A caller that is not reading the vault says which Error to raise instead, so a
 * feed that would not load does not arrive as a vault access failure.
 */
export async function throughHost<T>(
  call: Promise<T>,
  wrap: (message: string) => Error = (message) => new VaultAccessError(message),
): Promise<T> {
  try {
    return await call;
  } catch (error) {
    throw error instanceof Error ? error : wrap(String(error));
  }
}
