import { promises as fs } from "node:fs";
import { dirname } from "node:path";

/** Persist last-seen `seq` and optional snapshot hints across restarts. */
export interface HydraStateStore {
  loadLastSeq(): Promise<number | undefined>;
  saveLastSeq(seq: number): Promise<void>;
  saveSnapshotHint(json: string): Promise<void>;
  loadSnapshotHint(): Promise<string | undefined>;
}

/** Default in-memory implementation (tests / ephemeral sessions). */
export class InMemoryHydraStateStore implements HydraStateStore {
  private seq?: number;
  private hint?: string;

  async loadLastSeq(): Promise<number | undefined> {
    return this.seq;
  }

  async saveLastSeq(seq: number): Promise<void> {
    this.seq = seq;
  }

  async saveSnapshotHint(json: string): Promise<void> {
    this.hint = json;
  }

  async loadSnapshotHint(): Promise<string | undefined> {
    return this.hint;
  }
}

/** Node-only file-backed store; one JSON file with `{ seq, hint }`. */
export class FileHydraStateStore implements HydraStateStore {
  constructor(readonly filePath: string) {}

  private async read(): Promise<{ seq?: number; hint?: string }> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      return typeof parsed === "object" && parsed ? parsed : {};
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return {};
      throw err;
    }
  }

  private async write(data: { seq?: number; hint?: string }): Promise<void> {
    await fs.mkdir(dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(data), { encoding: "utf8", mode: 0o600 });
  }

  async loadLastSeq(): Promise<number | undefined> {
    const d = await this.read();
    return typeof d.seq === "number" ? d.seq : undefined;
  }

  async saveLastSeq(seq: number): Promise<void> {
    const d = await this.read();
    d.seq = seq;
    await this.write(d);
  }

  async saveSnapshotHint(json: string): Promise<void> {
    const d = await this.read();
    d.hint = json;
    await this.write(d);
  }

  async loadSnapshotHint(): Promise<string | undefined> {
    const d = await this.read();
    return typeof d.hint === "string" ? d.hint : undefined;
  }
}
