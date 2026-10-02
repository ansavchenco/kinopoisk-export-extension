export default defineBackground(() => {
  // A click on the toolbar icon opens the side panel. Firefox has no `sidePanel`.
  browser.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true })
})
