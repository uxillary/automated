'use strict';

// Keep the existing release collector's small config contract while sourcing its allow-list canonically.
module.exports = require('./project_metrics_config')
  .filter((project) => project.releaseDownloads)
  .map((project) => ({ repo: project.github, label: project.label }));
