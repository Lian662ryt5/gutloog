/* ---- Lightweight client-side error tracking ----
   Captures uncaught errors and unhandled promise rejections and logs them
   to a Supabase table (client_errors) for later review via the Supabase
   SQL editor/dashboard - the same place this project's owner already
   reviews cron runs and advisors. No third-party error-tracking service,
   no new CDN dependency, no CSP changes.

   Deliberately only catches what reaches the browser's global handlers -
   every error already caught locally elsewhere in the app (a failed
   sb.from(...) call wrapped in try/catch, for instance) is handled there
   and never reaches this file, so this only surfaces genuinely unexpected
   failures, not routine network hiccups. Loads right after core.js so it
   can catch errors from as much of the rest of the app's boot sequence as
   possible.

   Capped per page load so a runaway error loop can't spam the table. */
const CLIENT_ERROR_LOG_LIMIT = 5;
let clientErrorsLogged = 0;

async function logClientError(message, stack){
  if(clientErrorsLogged >= CLIENT_ERROR_LOG_LIMIT) return;
  clientErrorsLogged++;
  try{
    await sb.from('client_errors').insert({
      message: String(message || 'Unknown error').slice(0, 2000),
      stack: stack ? String(stack).slice(0, 4000) : null,
      url: location.href,
      user_agent: navigator.userAgent,
    });
  }catch(e){
    // Best-effort only - logging a logging failure would risk a loop.
  }
}

window.addEventListener('error', (event)=>{
  logClientError(event.message, event.error && event.error.stack);
});

window.addEventListener('unhandledrejection', (event)=>{
  const reason = event.reason;
  const message = (reason && reason.message) ? reason.message : String(reason);
  logClientError(message, reason && reason.stack);
});
