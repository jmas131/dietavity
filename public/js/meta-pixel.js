(function () {
  'use strict';

  var loader = document.currentScript;
  var pixelId = loader && String(loader.dataset.pixelId || '').trim();

  if (!/^[0-9]{5,20}$/.test(pixelId)) return;

  try {
    if (!window.fbq) {
      var fbq = function () {
        fbq.callMethod
          ? fbq.callMethod.apply(fbq, arguments)
          : fbq.queue.push(arguments);
      };

      window.fbq = fbq;
      if (!window._fbq) window._fbq = fbq;
      fbq.push = fbq;
      fbq.loaded = true;
      fbq.version = '2.0';
      fbq.queue = [];

      var script = document.createElement('script');
      script.async = true;
      script.src = 'https://connect.facebook.net/en_US/fbevents.js';
      var firstScript = document.getElementsByTagName('script')[0];
      firstScript.parentNode.insertBefore(script, firstScript);
    }

    if (!window.__dietavityMetaPixelInitialized) {
      window.__dietavityMetaPixelInitialized = true;
      window.fbq('init', pixelId);
      window.fbq('track', 'PageView');
    }

    var pageEvent = loader.dataset.pageEvent;
    if (pageEvent === 'ViewContent') {
      window.fbq('track', 'ViewContent', {
        content_name: '28-Day Program',
        value: 149,
        currency: 'MXN'
      });
    }

    if (pageEvent === 'Purchase') {
      var purchaseMarker = 'dietavity_meta_purchase_v1';
      var alreadyTracked = false;

      try {
        alreadyTracked = window.sessionStorage.getItem(purchaseMarker) === '1';
      } catch (storageError) {
        // Storage can be unavailable without affecting payment or access.
      }

      if (!alreadyTracked) {
        window.fbq('track', 'Purchase', {
          content_name: '28-Day Program',
          value: 149,
          currency: 'MXN'
        });

        try {
          window.sessionStorage.setItem(purchaseMarker, '1');
        } catch (storageError) {
          // Tracking remains best-effort when browser storage is blocked.
        }
      }
    }
  } catch (trackingError) {
    // Analytics must never interrupt the customer journey.
  }
})();
