export const APP_BEFORE_NAVIGATE_EVENT='omni:before-programmatic-navigation';

/** A cancelable signal for programmatic navigation outside the current page. */
export function requestAppNavigation():boolean{
  return window.dispatchEvent(new Event(APP_BEFORE_NAVIGATE_EVENT,{cancelable:true}));
}
