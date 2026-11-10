/*
 * video.js — YouTube embeds that load only when clicked (keeps pages light).
 *
 * Anywhere in any page:
 *   <div class="yt" data-id="VIDEO_ID" data-title="Title shown on the cover"></div>
 * On the home page, the grid is built from SITE_CONFIG.youtube (js/config.js).
 */
(function () {
  function mount(el) {
    var id = el.getAttribute("data-id");
    var list = el.getAttribute("data-list");
    var title = el.getAttribute("data-title") || "Video";
    if (!id && !list) return;

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "yt-play";
    btn.setAttribute("aria-label", "Play: " + title);
    if (id) btn.style.backgroundImage = "url(https://i.ytimg.com/vi/" + encodeURIComponent(id) + "/hqdefault.jpg)";
    var icon = document.createElement("span"); icon.className = "yt-icon"; icon.setAttribute("aria-hidden", "true");
    var cap = document.createElement("span"); cap.className = "yt-title"; cap.textContent = title;
    btn.appendChild(icon); btn.appendChild(cap);

    btn.addEventListener("click", function () {
      var frame = document.createElement("iframe");
      frame.src = id
        ? "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(id) + "?autoplay=1&rel=0"
        : "https://www.youtube-nocookie.com/embed/videoseries?list=" + encodeURIComponent(list) + "&autoplay=1";
      frame.title = title;
      frame.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
      frame.allowFullscreen = true;
      el.textContent = "";
      el.appendChild(frame);
    });
    el.appendChild(btn);
  }

  var cfg = window.SITE_CONFIG, grid = document.getElementById("video-grid");
  if (cfg && grid) {
    var y = cfg.youtube || {}, items = [];
    // A channel id "UC..." has an automatic "all uploads" playlist "UU...".
    if (/^UC/.test(y.channelId || "")) items.push({ list: "UU" + y.channelId.slice(2), title: "Latest uploads" });
    (y.videos || []).forEach(function (v) { if (v && v.id) items.push(v); });

    if (items.length) {
      grid.textContent = "";
      items.forEach(function (v) {
        var el = document.createElement("div");
        el.className = "yt";
        if (v.id) el.setAttribute("data-id", v.id);
        if (v.list) el.setAttribute("data-list", v.list);
        el.setAttribute("data-title", v.title || "Video");
        grid.appendChild(el);
      });
    }
    var link = document.getElementById("channel-link");
    if (link && y.channelUrl) { link.href = y.channelUrl; link.hidden = false; }
  }

  Array.prototype.forEach.call(document.querySelectorAll(".yt"), mount);
})();
