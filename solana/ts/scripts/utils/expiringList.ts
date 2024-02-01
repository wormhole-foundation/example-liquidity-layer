import { ParsedVaaWithBytes } from "@wormhole-foundation/relayer-engine";

export const expiringList = <T>(expirationInMs: number) => {
    type ListItem = {
        value: T;
        timestamp: number;
    };
    let list: ListItem[] = [];

    const purgeList = () => {
        const now = Date.now();
        list = list.filter((listItem) => {
            return now - listItem.timestamp <= expirationInMs;
        });
    };

    const add = (item: T) => {
        purgeList();
        if (has(item)) return;
        list.push({ value: item, timestamp: Date.now() });
    };

    const has = (item: T) => {
        const now = Date.now();
        return list.some((listItem) => {
            return listItem.value === item && now - listItem.timestamp <= expirationInMs;
        });
    };

    const remove = (item: T) => {
        list = list.filter((listItem) => {
            return listItem.value !== item;
        });
    };

    const count = () => {
        purgeList();
        return list.length;
    };

    const getAll = () => {
        purgeList();
        return list.map((listItem) => listItem.value);
    };

    return {
        add,
        has,
        remove,
        count,
        getAll,
    };
};
export type ExpiringList<T> = ReturnType<typeof expiringList<T>>;

export const vaaStringId = (vaa: ParsedVaaWithBytes) => {
    const emitterAddress = vaa.emitterAddress.toString("hex");
    const sequence = vaa.sequence.toString();
    return `${vaa.emitterChain.toString()}/${emitterAddress}/${sequence}`;
};
