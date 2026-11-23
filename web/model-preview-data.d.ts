export function modelPreviewIds(
    call: string,
    result: { isError?: boolean; details?: unknown } | null | undefined,
): string[];

export function checkModelPreview(bytes: ArrayBuffer): void;
