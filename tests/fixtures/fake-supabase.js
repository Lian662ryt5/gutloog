/* Served in place of the real Supabase CDN script (see tests/fixtures/helpers.js
   -> mockSupabase, which intercepts that exact request via page.route). A
   generic in-memory mock of the subset of PostgREST/supabase-js query-builder
   behavior the app actually uses: eq/gte/lte/lt/not/or/order/range/limit,
   insert/update/delete/upsert, single/maybeSingle, and the
   {count:'exact', head:true} option. Real filtering/ordering/pagination
   semantics run against an in-memory table, not canned per-call responses,
   so tests exercise the actual query logic the app sends.

   Seed data is read from window.__seedTables, set via page.addInitScript
   in tests/fixtures/helpers.js before this script runs. */
(function () {
  const CURRENT_USER_ID = 'test-user';
  const REPORT_HIDE_THRESHOLD = 3;

  // Mirrors the real trigger (public.recompute_restroom_report_state): keeps
  // restrooms.report_count/hidden in sync with restroom_reports rows.
  function recomputeRestroomReportState(tables, restroomId) {
    const restroom = (tables.restrooms || []).find((r) => r.id === restroomId);
    if (!restroom) return;
    const count = (tables.restroom_reports || []).filter((r) => r.restroom_id === restroomId).length;
    restroom.report_count = count;
    if (count >= REPORT_HIDE_THRESHOLD) restroom.hidden = true;
  }

  function isCurrentUserAdmin(tables) {
    const profile = (tables.profiles || []).find((p) => p.id === CURRENT_USER_ID);
    return !!(profile && profile.is_admin);
  }

  // Mirrors the real RLS policy "Authenticated users can view visible
  // restrooms" (hidden = false OR auth.uid() = user_id OR is_admin()). The
  // client never applies this filter itself - it's enforced entirely by
  // the database - so without simulating it here, a client-side regression
  // that started showing hidden spots to everyone would pass every test.
  function filterVisibleRestrooms(tables, rowsIn) {
    const admin = isCurrentUserAdmin(tables);
    return rowsIn.filter((r) => !r.hidden || r.user_id === CURRENT_USER_ID || admin);
  }

  function makeFakeSupabase(tables) {
    function query(tableName) {
      const state = { filters: [], orders: [], rangeVal: null, limitVal: null, countOpt: null, singleMode: null };
      const rows = () => tables[tableName] || [];

      function applyFilters(data) {
        let out = data;
        state.filters.forEach((f) => {
          if (f.op === 'eq') out = out.filter((r) => r[f.col] === f.val);
          else if (f.op === 'gte') out = out.filter((r) => r[f.col] != null && r[f.col] >= f.val);
          else if (f.op === 'lte') out = out.filter((r) => r[f.col] != null && r[f.col] <= f.val);
          else if (f.op === 'lt') out = out.filter((r) => r[f.col] != null && r[f.col] < f.val);
          else if (f.op === 'not_is_null') out = out.filter((r) => r[f.col] != null);
          else if (f.op === 'in') out = out.filter((r) => f.vals.includes(r[f.col]));
          else if (f.op === 'or_ilike') {
            const term = f.term.toLowerCase();
            out = out.filter((r) => f.cols.some((c) => (r[c] || '').toLowerCase().includes(term)));
          }
        });
        return out;
      }
      function applyOrder(data) {
        if (!state.orders.length) return data;
        return [...data].sort((a, b) => {
          for (const o of state.orders) {
            const av = a[o.col], bv = b[o.col];
            if (av === bv) continue;
            const cmp = av > bv ? 1 : -1;
            return o.ascending ? cmp : -cmp;
          }
          return 0;
        });
      }

      const builder = {
        select(_cols, opts) {
          state.countOpt = opts && opts.count ? { head: !!opts.head } : null;
          return builder;
        },
        eq(col, val) { state.filters.push({ op: 'eq', col, val }); return builder; },
        gte(col, val) { state.filters.push({ op: 'gte', col, val }); return builder; },
        lte(col, val) { state.filters.push({ op: 'lte', col, val }); return builder; },
        lt(col, val) { state.filters.push({ op: 'lt', col, val }); return builder; },
        not(col, kind, val) { if (kind === 'is' && val === null) state.filters.push({ op: 'not_is_null', col }); return builder; },
        in(col, vals) { state.filters.push({ op: 'in', col, vals }); return builder; },
        or(expr) {
          const parts = expr.split(',');
          const cols = parts.map((p) => p.split('.')[0]);
          const term = (parts[0].match(/%(.*)%/) || [, ''])[1];
          state.filters.push({ op: 'or_ilike', cols, term });
          return builder;
        },
        order(col, opts) { state.orders.push({ col, ascending: !opts || opts.ascending !== false }); return builder; },
        range(from, to) { state.rangeVal = [from, to]; return builder; },
        limit(n) { state.limitVal = n; return builder; },
        single() { state.singleMode = 'single'; return builder; },
        maybeSingle() { state.singleMode = 'maybeSingle'; return builder; },
        insert(row) { state.insertRow = row; return builder; },
        delete() { state.deleteMode = true; return builder; },
        update(patch) { state.updatePatch = patch; return builder; },
        upsert(row) { state.upsertRow = row; return builder; },
        then(resolve, reject) {
          try { resolve(execute()); } catch (e) { if (reject) reject(e); else resolve({ data: null, error: e, count: null }); }
        },
        catch() { return builder; },
      };

      function execute() {
        if (state.insertRow) {
          // Mirrors columns that default to auth.uid() server-side - the app
          // never sets user_id itself on these tables, same as real Postgres.
          const row = { id: Math.floor(Math.random() * 1e9), user_id: CURRENT_USER_ID, ...state.insertRow };
          if (tableName === 'restroom_reports') {
            const dup = (tables.restroom_reports || []).some(
              (r) => r.restroom_id === row.restroom_id && r.user_id === row.user_id
            );
            if (dup) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
          }
          tables[tableName] = tables[tableName] || [];
          tables[tableName].push(row);
          if (tableName === 'restroom_reports') recomputeRestroomReportState(tables, row.restroom_id);
          return { data: state.singleMode ? row : [row], error: null };
        }
        if (state.deleteMode) {
          const before = rows();
          const toDelete = applyFilters(before);
          tables[tableName] = before.filter((r) => !toDelete.includes(r));
          if (tableName === 'restroom_reports') {
            const affected = [...new Set(toDelete.map((r) => r.restroom_id))];
            affected.forEach((id) => recomputeRestroomReportState(tables, id));
          }
          if (tableName === 'restrooms') {
            const deletedIds = toDelete.map((r) => r.id);
            tables.restroom_reports = (tables.restroom_reports || []).filter((r) => !deletedIds.includes(r.restroom_id));
          }
          return { data: null, error: null };
        }
        if (state.updatePatch) {
          applyFilters(rows()).forEach((r) => Object.assign(r, state.updatePatch));
          return { data: null, error: null };
        }
        if (state.upsertRow) {
          tables[tableName] = tables[tableName] || [];
          const key = ['user_id', 'reminder_type', 'local_date'];
          const existing = tables[tableName].find((r) =>
            key.every((k) => !(k in state.upsertRow) || r[k] === state.upsertRow[k])
            && key.some((k) => k in state.upsertRow)
          );
          if (existing) Object.assign(existing, state.upsertRow);
          else tables[tableName].push({ ...state.upsertRow });
          return { data: null, error: null };
        }

        let source = rows();
        if (tableName === 'restrooms') source = filterVisibleRestrooms(tables, source);
        let data = applyFilters(source);
        const totalCount = data.length;
        data = applyOrder(data);
        if (state.rangeVal) data = data.slice(state.rangeVal[0], state.rangeVal[1] + 1);
        else if (state.limitVal != null) data = data.slice(0, state.limitVal);

        if (state.countOpt && state.countOpt.head) return { data: null, error: null, count: totalCount };
        if (state.singleMode === 'single') return { data: data[0] || null, error: data[0] ? null : new Error('no rows') };
        if (state.singleMode === 'maybeSingle') return { data: data[0] || null, error: null };
        return { data, error: null, count: totalCount };
      }

      return builder;
    }

    // Normally a session exists from the very first getSession() call, like a
    // returning visitor. Tests of the cold-start (brand-new visitor, no
    // session yet) path set window.__startWithNoSession before the app
    // loads, so getSession() starts null until signInAnonymously() is
    // called - letting a test catch multiple concurrent callers each
    // creating their own anonymous session (window.__signInAnonymouslyCalls
    // counts real calls, not cache hits).
    let currentSession = window.__startWithNoSession ? null : { user: { id: 'test-user' }, access_token: 'test' };
    window.__signInAnonymouslyCalls = 0;
    return {
      createClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: currentSession } }),
          signInAnonymously: async () => {
            window.__signInAnonymouslyCalls++;
            currentSession = { user: { id: 'test-user' }, access_token: 'test' };
            return { data: { session: currentSession }, error: null };
          },
          getUser: async () => ({ data: { user: { id: 'test-user' } } }),
          updateUser: async () => ({ error: null }),
        },
        from: (t) => query(t),
        storage: {
          from: () => ({
            // Real storage.upload() is a network call, so it should fail
            // like one when the browser is offline - unlike this in-memory
            // mock, which would otherwise "succeed" no matter what
            // page.context().setOffline() says.
            upload: async () => {
              if (!navigator.onLine) return { error: { message: 'Failed to fetch' } };
              return { error: null };
            },
            getPublicUrl: () => ({ data: { publicUrl: 'https://example.test/fake-photo.jpg' } }),
          }),
        },
      }),
    };
  }

  const seedTables = window.__seedTables || {};
  window.supabase = makeFakeSupabase(seedTables);
  window.__fakeTables = seedTables;
})();
