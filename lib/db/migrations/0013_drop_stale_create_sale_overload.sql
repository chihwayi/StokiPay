-- Migration 0011's `create or replace function stockflow_create_sale`
-- added a new p_customer_id parameter. Postgres only replaces a function
-- with the exact same signature — a different parameter count creates a
-- second overload instead, so the original Sprint 3 (6-parameter)
-- version was still callable alongside the new 7-parameter one. This
-- risks PostgREST resolving the wrong overload (or refusing to pick one)
-- depending on how a client's RPC call is shaped. Drop the stale one —
-- every caller must go through the 7-parameter version from here on
-- (p_customer_id defaults to null, so existing non-credit callers are
-- unaffected).

drop function if exists public.stockflow_create_sale(uuid, uuid, uuid, text, jsonb, jsonb);
