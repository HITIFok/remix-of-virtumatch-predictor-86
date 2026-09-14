// Loading/error handler — loaded from external file for CSP compliance
(function() {
  'use strict';
  // Hide loading after app mounts
  window.addEventListener('load', function() {
    setTimeout(function() {
      var loading = document.getElementById('loading');
      if (loading) loading.style.display = 'none';
    }, 500);
  });

  // Show error if JS fails
  window.onerror = function(msg, url, line) {
    var loading = document.getElementById('loading');
    var error = document.getElementById('error');
    var errorDetail = document.getElementById('error-detail');
    if (loading) loading.style.display = 'none';
    if (error) error.classList.add('show');
    if (errorDetail) errorDetail.textContent = msg + ' (' + line + ')';
    return false;
  };
})();
