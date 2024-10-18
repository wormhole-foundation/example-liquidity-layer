import { PublicKey } from "@solana/web3.js";

export const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
    "BPFLoaderUpgradeab1e11111111111111111111111",
);

export function programDataAddress(programId: PublicKey) {
    return PublicKey.findProgramAddressSync(
        [programId.toBuffer()],
        BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    )[0];
}

export class ArrayQueue<T> {
    private _data: Array<T | null>;
    private _size: number = 0;
    private _index: number = 0;

    constructor(capacity?: number) {
        this._data = new Array(capacity ?? 256).fill(null);
    }

    head(): T | null {
        if (this.isEmpty()) {
            return null;
        }

        return this._data[this._index]!;
    }

    enqueue(value: T): void {
        const data = this._data;
        const size = this._size;
        const index = this._index;

        if (size + 1 > data.length) {
            this.resize();
        }

        data[(index + size) % data.length] = value;
        ++this._size;
    }

    dequeue(): void {
        if (this.isEmpty()) {
            return;
        }

        const data = this._data;
        const index = this._index;

        this._index = (index + 1) % data.length;
        --this._size;
    }

    resize(): void {
        const data = this._data;
        const size = this._size;
        const index = this._index;

        const newData = new Array(size * 2);
        for (let i = 0; i < size; ++i) {
            newData[i] = data[(index + i) % data.length];
        }

        this._data = newData;
        this._index = 0;
    }

    isEmpty(): boolean {
        return this._size == 0;
    }

    length(): number {
        return this._size;
    }
}
