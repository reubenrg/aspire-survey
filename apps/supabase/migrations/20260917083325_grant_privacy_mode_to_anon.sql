-- privacy_mode is metadata about how a survey behaves, not response data - a
-- respondent needs to know it to render the correct privacy notice on the
-- open /s/:slug path (the /r/:token path already gets it via resolve_invitation's
-- return value, which is why only the invited path could show it until now).
grant select (privacy_mode) on public.surveys to anon;
