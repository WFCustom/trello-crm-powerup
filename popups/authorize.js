/**
 * Standalone "click to authorize" popup.
 *
 * Trello's docs are explicit that client.authorize() must NOT be called
 * directly from a capability callback (e.g. a card-buttons callback) --
 * the browser won't treat that as a real click and will block the consent
 * popup. The fix is to open a popup (this file) that contains a real
 * button, and call authorize from that button's own click handler.
 * See: https://developer.atlassian.com/cloud/trello/power-ups/rest-api-client/
 */
const t = TrelloPowerUp.iframe({ appKey: window.WF_CONFIG.appKey, appName: "Western Fabrication Ops" });

document.getElementById("go").addEventListener("click", function () {
  WFRest.authorize(t, "read,write")
    .then(function () {
      return t.closePopup();
    })
    .catch(function (err) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = (err && err.message) ? err.message : "Authorization was cancelled.";
      document.body.appendChild(p);
    });
});
