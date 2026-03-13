import type { AppwriteEnv } from "./runtime-env";

export class AppwriteHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppwriteHttpError";
  }
}

export interface AppwriteRowList<Row> {
  total: number;
  rows: Row[];
}

function buildQuery(
  method: string,
  attribute?: string,
  values?: Array<string | number | boolean> | string | number | boolean,
) {
  return JSON.stringify({
    method,
    attribute,
    values: values === undefined ? undefined : Array.isArray(values) ? values : [values],
  });
}

function appendQueryParam(searchParams: URLSearchParams, key: string, value: unknown) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => appendQueryParam(searchParams, `${key}[${index}]`, item));
    return;
  }
  if (value === undefined || value === null) return;
  searchParams.append(key, String(value));
}

export const AppwriteQuery = {
  equal(field: string, values: Array<string | number | boolean>) {
    return buildQuery("equal", field, values);
  },
  startsWith(field: string, value: string) {
    return buildQuery("startsWith", field, value);
  },
  contains(field: string, value: string) {
    return buildQuery("contains", field, value);
  },
  greaterThanEqual(field: string, value: string | number | boolean) {
    return buildQuery("greaterThanEqual", field, value);
  },
  lessThanEqual(field: string, value: string | number | boolean) {
    return buildQuery("lessThanEqual", field, value);
  },
  orderAsc(field: string) {
    return buildQuery("orderAsc", field);
  },
  orderDesc(field: string) {
    return buildQuery("orderDesc", field);
  },
  limit(value: number) {
    return buildQuery("limit", undefined, Math.max(1, Math.trunc(value)));
  },
  offset(value: number) {
    return buildQuery("offset", undefined, Math.max(0, Math.trunc(value)));
  },
};

export class AppwriteClient {
  constructor(private readonly env: AppwriteEnv) {}

  private buildUrl(pathname: string, params?: Record<string, unknown>) {
    const base = this.env.endpoint.endsWith("/")
      ? this.env.endpoint.slice(0, -1)
      : this.env.endpoint;
    const url = new URL(`${base}${pathname}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => appendQueryParam(url.searchParams, key, value));
    }
    return url;
  }

  private async request<ResponseShape>(
    method: string,
    pathname: string,
    options?: {
      params?: Record<string, unknown>;
      body?: Record<string, unknown>;
      allow404?: boolean;
    },
  ): Promise<ResponseShape | null> {
    const url = this.buildUrl(pathname, method.toUpperCase() === "GET" ? options?.params : undefined);
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Appwrite-Project": this.env.projectId,
        "X-Appwrite-Key": this.env.apiKey,
        "X-Appwrite-Response-Format": "1.8.0",
      },
      body: method.toUpperCase() === "GET" || options?.body === undefined
        ? undefined
        : JSON.stringify(options.body),
    });

    if (options?.allow404 && response.status === 404) return null;

    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new AppwriteHttpError(
        typeof data?.message === "string" ? data.message : `Appwrite request failed (${response.status})`,
        response.status,
        data,
      );
    }
    return data as ResponseShape;
  }

  listRows<Row>(
    tableId: string,
    queries: string[] = [],
    options?: {
      total?: boolean;
      ttl?: number;
    },
  ) {
    return this.request<AppwriteRowList<Row>>("GET", `/tablesdb/${this.env.databaseId}/tables/${tableId}/rows`, {
      params: {
        queries,
        total: options?.total,
        ttl: options?.ttl,
      },
    }).then((result) => result ?? { total: 0, rows: [] });
  }

  async listAllRows<Row>(
    tableId: string,
    queries: string[] = [],
    batchSize = 100,
  ): Promise<Row[]> {
    const rows: Row[] = [];
    let offset = 0;

    while (true) {
      const page = await this.listRows<Row>(
        tableId,
        [...queries, AppwriteQuery.limit(batchSize), AppwriteQuery.offset(offset)],
        { total: false },
      );
      rows.push(...page.rows);
      if (page.rows.length < batchSize) break;
      offset += page.rows.length;
    }

    return rows;
  }

  getRow<Row>(tableId: string, rowId: string) {
    return this.request<Row>("GET", `/tablesdb/${this.env.databaseId}/tables/${tableId}/rows/${encodeURIComponent(rowId)}`, {
      allow404: true,
    });
  }

  upsertRow<Row>(tableId: string, rowId: string, data: Record<string, unknown>) {
    return this.request<Row>("PUT", `/tablesdb/${this.env.databaseId}/tables/${tableId}/rows/${encodeURIComponent(rowId)}`, {
      body: { data },
    });
  }

  createRows<Row>(tableId: string, rows: Array<{ rowId: string; data: Record<string, unknown> }>) {
    return Promise.all(
      rows.map((row) => this.upsertRow<Row>(tableId, row.rowId, row.data)),
    ).then((createdRows) => ({
      total: createdRows.length,
      rows: createdRows,
    }));
  }

  upsertRows<Row>(tableId: string, rows: Array<{ rowId: string; data: Record<string, unknown> }>) {
    return Promise.all(
      rows.map((row) => this.upsertRow<Row>(tableId, row.rowId, row.data)),
    ).then((upsertedRows) => ({
      total: upsertedRows.length,
      rows: upsertedRows,
    }));
  }

  updateRows<Row>(tableId: string, data: Record<string, unknown>, queries: string[]) {
    return this.request<AppwriteRowList<Row>>("PATCH", `/tablesdb/${this.env.databaseId}/tables/${tableId}/rows`, {
      body: { data, queries },
    }).then((result) => result ?? { total: 0, rows: [] });
  }

  deleteRow(tableId: string, rowId: string) {
    return this.request<unknown>("DELETE", `/tablesdb/${this.env.databaseId}/tables/${tableId}/rows/${encodeURIComponent(rowId)}`, {
      body: {},
      allow404: true,
    });
  }
}
