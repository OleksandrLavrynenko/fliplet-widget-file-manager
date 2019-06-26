/* eslint-disable */
var widgetId = parseInt(Fliplet.Widget.getDefaultId(), 10);
var data = Fliplet.Widget.getData(widgetId) || {};
var $folderContents = $('.file-table-body');
var $organizationList = $('.dropdown-menu-holder .panel-group');
var $progress = $('.progress');
var $progressBar = $progress.find('.progress-bar');
var $dropZone = $('#drop-zone');
var templates = {
  file: template('file'),
  folder: template('folder'),
  organizations: template('organizations'),
  apps: template('apps')
};
var $searchType = $('.search-type');
var $searchTerm = $('.search-term');
var $fileTable = $('.file-table');
var $pagination = $('.pagination');

// This should contain either app/org/folder of current folder
var currentSelection;

var currentOrganizationId;
var currentFolderId;
var currentAppId;
var currentFolders;
var currentFiles;
var counterOrganization;
var currentSearchResult;

var tetherBox;

var folders = [];
var apps;
var organizations;
var navStack = [];
var beforeSearchNavStack = [];

var sideBarMinWidth = 240;
var sideBarMaxWidth = 395;

var searchDebounceTime = 500;

// Keep it as false because people copy this URL and use it into their apps,
// therefore we want this to be an clean direct link to the API with no token.
var useCdn = false;

// CORE FUNCTIONS //
// Get organizations and apps list for left side menu
function getOrganizationsList() {
  counterOrganization = 0;
  Fliplet.Organizations.get().then(function(organizations) {
    // Sort alphabetically
    organizations = _.sortBy(organizations, [function(o) {
      return o.name;
    }]);
    // Add to HTML
    organizations.forEach(addOrganizations);
  }).then(function() {
    getAppsList();
    $('.file-cell.selectable').addClass('active');
  });
}

function parseThumbnail(file) {
  if (file.thumbnail) {
    return;
  }

  file.thumbnail = Fliplet.Media.authenticate(file.url.replace(Fliplet.Env.get('apiUrl'), Fliplet.Env.get('apiCdnUrl')));
}

function navigateToDefaultFolder() {
  if (typeof data === 'undefined' || !data || !data.appId) {
    // No folder was specified
    return;
  }

  var $listHolder;
  var folderId;
  var type;
  var $el = $('[data-app-id="' + data.appId + '"][data-browse-folder]');

  // Activate folder on left sidebar
  if ($el.data('type') === 'organization') {
    $listHolder = $el;
  } else {
    $listHolder = $el.find('.list-holder');
  }
  
  $('.dropdown-menu-holder').find('.list-holder.active').removeClass('active');
  $listHolder.first().addClass('active');

  // Set first folder of breadcrumbs
  resetUpTo($el);
  
  if (data.appId) {
    getFolderContents($el, true);
    return;
  }
  if (data.navStack && data.folder) {
    // Updates navStack with folders before the selected one
    var newNavStack = data.navStack.upTo.slice(1);
    newNavStack.forEach(function(obj, idx) {
      navStack.push(obj);
    });

    // Updates navStack with selected folder
    navStack.push(data.folder);
    navStack.forEach(function(obj, idx) {
      if (idx !== 0) {
        obj.back = function() {
          getFolderContentsById(obj.id);
        }
      }
    });

    folderId = data.folder.id;
    type = 'folder';
    updatePaths();
  }
  getFolderContentsById(folderId, type);
}

function getAppsList() {
  Fliplet.Apps.get().then(function(apps) {
    // Remove V1 apps
    apps.filter(function(app) {
      return !app.legacy;
    });
    // Sort apps alphabetically
    apps = _.sortBy(apps, [function(o) {
      return o.name;
    }]);
    // Add apps to HTML
    apps.forEach(addApps);

    navigateToDefaultFolder();
  });
}

function getFolderContentsById(id, type, isSearchNav) {
  var options = {
    cdn: useCdn
  };

  var filterFiles = function(files) {
    return true
  };
  var filterFolders = function(folders) {
    return true
  };

  if (type === "app") {
    options.appId = currentAppId = id;
    currentFolderId = null;

    // Filter functions
    filterFiles = function(file) {
      return !file.mediaFolderId;
    };
    filterFolders = function(folder) {
      return !folder.parentFolderId;
    };
  } else if(type  === "organization"){
    options.organizationId = currentOrganizationId = id;
    currentAppId = null;
    currentFolderId = null;

    // Filter functions
    filterFiles = function(file) {
      return !(file.appId || file.mediaFolderId);
    };
    filterFolders = function(folder) {
      return !(folder.appId || folder.parentFolderId);
    };
  } else {
    options.folderId = currentFolderId = id;
  }

  currentFolders = [];
  currentFiles = [];
  $folderContents.empty();

  Fliplet.Media.Folders.get(options).then(function(response) {
    if(!isSearchNav) {
      var navItem = navStack[navStack.length - 1];
      switch (navItem.type) {
        case 'organizationId':
          return;
        case 'appId':
          // User is no longer browsing the app folder
          if (!options.hasOwnProperty('appId') || parseInt(options.appId, 10) !== navItem.id) {
            return;
          }
          break;
        case 'folderId':
          // User is no longer browsing folder
          if (!options.hasOwnProperty('folderId') || parseInt(options.folderId, 10) !== navItem.id) {
            return;
          }
          break;
      }

      if (!$folderContents.is(':empty')) {
        // Content already rendered from a recent request. Do nothing.
        return;
      }
    }
    if (response.files.length === 0 && response.folders.length === 0) {
      $('.empty-state').addClass('active');
      $('.file-cell.selectable').addClass('active');
    } else {
      folders = response.folders;

      // Filter only the files from that request app/org/folder
      var mediaFiles = response.files.filter(filterFiles);
      var mediaFolders = response.folders.filter(filterFolders);

      mediaFiles.forEach(parseThumbnail);

      mediaFolders.forEach(addFolder);
      mediaFiles.forEach(addFile);

      renderList();
    }
  }, function() {
    $('.empty-state').addClass('active');
  });
}

// Get folders and files depending on ID (Org, App, Folder) to add to the content area
function getFolderContents(el, isRootFolder) {
  if (isRootFolder) {
    // Restart breadcrumbs
    var $el = el;
    var $listHolder;

    if ($el.data('type') === 'organization') {
      $listHolder = $el;
    } else {
      $listHolder = $el.find('.list-holder');
    }

    $('.dropdown-menu-holder').find('.list-holder.active').removeClass('active');
    $listHolder.first().addClass('active');
  }

  var options = {
    cdn: useCdn
  };

  // Default filter functions
  var filterFiles = function(files) {
    return true
  };
  var filterFolders = function(folders) {
    return true
  };

  if (el.attr('data-type') === "app") {
    options.appId = el.attr('data-app-id');
    currentAppId = el.attr('data-app-id');
    currentFolderId = null;

    // Filter functions
    filterFiles = function(file) {
      return !file.mediaFolderId;
    };
    filterFolders = function(folder) {
      return !folder.parentFolderId;
    };
  } else if (el.attr('data-type') === "organization") {
    options.organizationId = currentOrganizationId = el.attr('data-org-id');
    currentAppId = null;
    currentFolderId = null;

    // Filter functions
    filterFiles = function(file) {
      return !(file.appId || file.mediaFolderId);
    };
    filterFolders = function(folder) {
      return !(folder.appId || folder.parentFolderId);
    };
  } else {
    options.folderId = el.attr('data-id');
    currentFolderId = el.attr('data-id');
  }

  currentFolders = [];
  currentFiles = [];
  $folderContents.empty();

  Fliplet.Media.Folders.get(options).then(function(response) {
    var navItem = navStack[navStack.length - 1];
    switch (navItem.type) {
      case 'organizationId':
        // User is no longer browsing the organization folder
        if (options.hasOwnProperty('folderId') || !options.hasOwnProperty('organizationId') || parseInt(options.organizationId, 10) !== navItem.id) {
          return;
        }
        break;
      case 'appId':
        // User is no longer browsing the app folder
        if (!options.hasOwnProperty('appId') || parseInt(options.appId, 10) !== navItem.id) {
          return;
        }
        break;
      case 'folderId':
        // User is no longer browsing the folder
        if (!options.hasOwnProperty('folderId') || parseInt(options.folderId, 10) !== navItem.id) {
          return;
        }
        break;
    }

    if (!$folderContents.is(':empty')) {
      // Content already rendered from a recent request. Do nothing.
      return;
    }

    if (response.files.length === 0 && response.folders.length === 0) {
      $('.file-cell.selectable').addClass('active');
      $('.empty-state').addClass('active');
    } else {
      folders = response.folders;

      // Filter only the files from that request app/org/folder
      var mediaFiles = response.files.filter(filterFiles);
      var mediaFolders = response.folders.filter(filterFolders);

      mediaFolders.forEach(addFolder);
      mediaFiles.forEach(addFile);

      mediaFiles.forEach(parseThumbnail);

      renderList();
    }
  }, function() {
    $('.empty-state').addClass('active');
  });
}

// Adds organization item template
function addOrganizations(organizations) {
  $organizationList.append(templates.organizations(organizations));

  if ($organizationList.find('.panel-title').length !== 1) {
    return;
  }

  $(".panel-collapse").first().collapse('show');
  var orgEl = $organizationList.find('.panel-title').first();
  var orgName = $organizationList.find('.panel-title').first().find('.list-text-holder span').first().text();

  $organizationList.find('.panel-title').first().addClass('active');

  // Store to nav stack
  backItem = {
    id: $organizationList.find('.panel-title').first().data('org-id'),
    name: orgName,
    tempElement: $organizationList.find('.panel-title').first()
  };
  backItem.back = function() {
    getFolderContents(backItem.tempElement);
  };
  backItem.type = 'organizationId';
  navStack.push(backItem);

  $('.header-breadcrumbs .current-folder-title').html('<span class="bread-link"><a href="#">' + orgName + '</a></span>');

  if (typeof data === 'undefined' || !data || !data.appId) {
    getFolderContents(orgEl);
  }
}

// Adds app item template
function addApps(apps) {
  var $appList = $('.dropdown-menu-holder #organization-' + apps.organizationId + ' .panel-body');
  $appList.append(templates.apps(apps));
}

// Adds folder item template
function addFolder(folder) {
  folder.formattedDate = formatDate(folder.createdAt);

  currentFolders.push(folder);
  folders.push(folder);

  $('.empty-state').removeClass('active');
  // Toggle checkbox header to false
  $('.file-table-header input[type="checkbox"]').prop('checked', false);
  $('.file-cell.selectable').css({'opacity': '1', 'visibility': 'visible'});
}

// Adds file item template
function addFile(file) {
  file.formattedDate = formatDate(file.createdAt);

  currentFiles.push(file);

  $('.empty-state').removeClass('active');
  $('.new-menu').removeClass('active');

  // Toggle checkbox header to false
  $('.file-table-header input[type="checkbox"]').prop('checked', false);
  $('.file-cell.selectable').css({'opacity': '1', 'visibility': 'visible'});
}

// Templating
function template(name) {
  return Handlebars.compile($('#template-' + name).html());
}

function checkboxStatus() {
  var numberOfRows = $('.file-row').length;
  var numberOfActiveRows = $('.file-row.active').length;
  var fileURL = $('.file-row.active').data('file-url');
  $('.items-selected').html(numberOfActiveRows > 1 ? numberOfActiveRows + ' items' : numberOfActiveRows + ' item');

  if (numberOfRows === 0) {
    $('.empty-state').addClass('active');
    $('.file-cell.selectable').removeClass('active');
  }

  if ($('.file-row').hasClass('active')) {
    $('.side-actions').addClass('active');
    $('.file-cell.selectable').addClass('active');
    $('.file-row').not(this).addClass('passive');
    $('.help-tips').addClass('hidden');
  } else {
    $('.side-actions').removeClass('active');
    $('.file-row').not(this).removeClass('passive');
    $('.help-tips').removeClass('hidden');
    $('.side-actions .item').removeClass('show');
  }

  $('.side-actions .item').removeClass('show');
  $('.side-actions .item-actions').removeClass('single multiple');
  if (numberOfActiveRows > 1) {
    $('.side-actions .item.multiple').addClass('show');
    $('.side-actions .item-actions').addClass('multiple');
  } else if (numberOfActiveRows === 1) {
    var itemType = $('.file-row.active').data('file-type');
    $('.side-actions .item-actions').addClass('single');
    if (itemType === 'folder') {
      $('.side-actions .item.folder').addClass('show');
    } else if (itemType === 'image') {
      $('.side-actions .item.image').addClass('show');
      $('.side-actions .item.image').find('img').attr('src', fileURL);
    } else {
      $('.side-actions .item.file').addClass('show');
    }
  }

  if (numberOfRows === numberOfActiveRows) {
    $('.file-table-header input[type="checkbox"]').prop('checked', true);
  } else {
    $('.file-table-header input[type="checkbox"]').prop('checked', false);
  }
}

function toggleAll(el) {
  if (el.is(':checked')) {
    $('.file-row input[type="checkbox"]').each(function() {
      $(this).prop('checked', true);
      $(this).parents('.file-row').addClass('active');
      $('.side-actions').addClass('active');
      $('.help-tips').addClass('hidden');
    });
  } else {
    $('.file-row input[type="checkbox"]').each(function() {
      $(this).prop('checked', false);
      $(this).parents('.file-row').removeClass('active');
      $('.file-row').removeClass('passive');
    });
  }

  var numberOfActiveRows = $('.file-row.active').length;
  $('.items-selected').html(numberOfActiveRows > 1 ? numberOfActiveRows + ' items' : numberOfActiveRows + ' item');

  $('.side-actions .item').removeClass('show');
  $('.side-actions .item-actions').removeClass('single multiple');
  if (numberOfActiveRows > 1) {
    $('.side-actions .item.multiple').addClass('show');
    $('.side-actions .item-actions').addClass('multiple');
  } else if (numberOfActiveRows === 1) {
    $('.side-actions .item-actions').addClass('single');
  }

  if (!$('.file-row').hasClass('active')) {
    $('.side-actions').removeClass('active');
    $('.side-actions .item').removeClass('show');
    $('.help-tips').removeClass('hidden');
  }
}

function updatePaths() {
  if (navStack.length > 1) {
    var breadcrumbsPath = '';
    var type = '';
    var idType = '';
    var dataType = '';

    for (var i = 0; i < navStack.length; i++) {
      switch (navStack[i].type) {
        case 'organizationId':
          type = 'organization';
          idType = 'data-org-id=';
          dataType = 'data-type=';
          break;
        case 'appId':
          type = 'app';
          idType = 'data-app-id=';
          dataType = 'data-type=';
          break;
        case 'folderId':
          type = 'folder';
          idType = 'data-id=';
          dataType = 'data-file-type=';
          break;
        default:
          throw new Error('Not supported type ');
      }

      breadcrumbsPath += '<span class="bread-link"' + dataType + '"' + type + '" ' + idType + '"'
        + navStack[i].id + '"><a href="#" data-breadcrumb="' + i + '">' + navStack[i].name + '</a></span>';
    }

    $('.header-breadcrumbs .current-folder-title').html(breadcrumbsPath);
    return;
  }

  // Current folder
  $('.header-breadcrumbs .current-folder-title').html('<span class="bread-link"><a href="#">' + navStack[navStack.length - 1].name + '</a></span>');
}

function resetUpTo(element) {
  navStack = [];

  if (element.attr('data-type') === "app") {
    backItem = {
      id: element.data('app-id'),
      name: element.find('.list-text-holder span').first().text(),
      tempElement: element
    };
    backItem.type = 'appId';
  } else if (element.attr('data-type') === "organization") {
    backItem = {
      id: element.data('org-id'),
      name: element.find('.list-text-holder span').first().text(),
      tempElement: element
    };
    backItem.type = 'organizationId';
  } else {
    backItem = {
      id: element.data('id'),
      name: element.find('.list-text-holder span').first().text(),
      tempElement: element
    };
    backItem.type = 'folderId';
  }
  backItem.back = function() {
    getFolderContents(backItem.tempElement);
  };

  navStack.push(backItem);
  updatePaths();
}

// Resets navigation to first item
function resetToTop(){
  navStack = [navStack[0]];
  updatePaths();
}

function showDropZone() {
  $('.drop-zone-folder-name').html(navStack[navStack.length - 1].name);
  $dropZone.addClass('active');
}

function hideDropZone() {
  $dropZone.removeClass('active');
}

function uploadFiles(files) {
  var formData = new FormData();
  var file;
  for (var i = 0; i < files.length; i++) {
    file = files.item(i);
    formData.append('name[' + i + ']', file.name);
    formData.append('files[' + i + ']', file);
  }

  $progressBar.css({
    width: '0%'
  });
  $progress.removeClass('hidden');

  Fliplet.Media.Files.upload({
    folderId: currentFolderId,
    appId: currentAppId,
    name: file.name,
    data: formData,
    progress: function(percentage) {
      $progressBar.css({
        width: percentage + '%'
      });
    }
  }).then(function(files) {
    files.forEach(function(file) {
      addFile(file);
      insertItem(file);
    });

    $progress.addClass('hidden');
  });
}


// Sorts items by name
function sortItems(items) {
  return _.sortBy(items, [
    function (item) {
      return item.name.toLowerCase();
    },
    'id'
  ]);
}

// Adds single item to DOM
function renderItem(item, isFolder, insertIndex) {
  var template = isFolder ? templates.folder(item) : templates.file(item);

  if (insertIndex >= 0) {
    var $item = $folderContents.find('.file-row').eq(insertIndex);
    $item.before(template);
  } else {
    $folderContents.append(template);
  }
}

// Renders sorted list of folders and files
function renderList() {
  var folders = sortItems(currentFolders);
  var files = sortItems(currentFiles);

  $folderContents.empty();

  folders.forEach(function (folder) {
    renderItem(folder, true);
  });

  files.forEach(function (file) {
    renderItem(file, false);
  });
}

//Finds insert index for a new item
function findItemInsertIndex(item, isFolder) {
  var items = sortItems(currentFolders).concat(sortItems(currentFiles));
  items = items.filter(function (i) {
    return i.id !== item.id;
  });

  var insertIndex = -1;

  for (var i = 0; i < items.length; i++) {
    if (items[i].name.toLowerCase() > item.name.toLowerCase()) {
      insertIndex = i;
      break;
    }
  }

  if (insertIndex === -1) {
    if (isFolder) {
      if (currentFolders.length) {
        if (currentFiles.length) {
          insertIndex = currentFolders.length - 1;
        }
      } else {
        if (currentFiles.length) {
          insertIndex = 0;
        }
      }
    }
  }

  return insertIndex;
}

//Inserts new item to a specific position to the item list
function insertItem(item, isFolder) {
  var insertIndex = findItemInsertIndex(item, isFolder);
  renderItem(item, isFolder, insertIndex);
}

function search(type, term) {
  var query = {
    name: term
  };

  if (type == 'all') {
    if (currentAppId) {
      query.appId = currentAppId;
    } else {
      query.organizationId = currentOrganizationId;
    }
  } else {
    if (currentFolderId) {
      query.folderId = currentFolderId;
    } else if (currentAppId) {
      query.appId = currentAppId;
    } else {
      query.organizationId = currentOrganizationId;
    }
  }

  return Fliplet.Media.Folders.search(query).then(function (result) {
    currentSearchResult = result;
    renderSearchResult(result, type);
  });
}

function renderSearchResult(result, searchType) {
  enableSearchState();

  if (!result || !result.length) {
    showNothingFoundAlert(true);
    return;
  }

  if (searchType == 'all') {
    resetToTop();
  }

  result = result
    .filter(function (item) {
      return !item.deletedAt;
    })
    .map(function (item) {
      item.relativePath = calculatePath(item);

      if (item.parentId) {
        item.parentItemType = 'folder';
        item.parentItemId = item.parentId;
      } else if (item.appId) {
        item.parentItemType = 'app';
        item.parentItemId = item.appId;
      } else {
        item.parentItemType = 'organization';
        item.parentItemId = item.organizationId;
      }

      if (item.type !== 'folder') {
        item.dimensions = item.size ? item.size.join('x') : null;
      }

      return item;
    });

  $pagination.pagination({
    dataSource: result,
    pageSize: 10,
    callback: function (data) {
      $folderContents.empty();

      data.forEach(function (item) {
        if (item.type === 'folder') {
          addFolder(item)
        } else {
          item.dimensions = item.size ? item.size.join('x') : null;
          addFile(item);
        }
      });
    }
  });
}

// Builds a relative path to folder or file
function calculatePath(item) {
  var path = [];
  var separator = '/';
  var isLast = false;

  var getNames = function (item) {
    if (!item) {
      return;
    }
    if (item.parentFolder) {
      getNames(item.parentFolder);
    } else {
      isLast = true;
    }

    if (isLast && item.id === +currentFolderId) {
      return;
    }

    path.push(item.name);
  };

  getNames(item.parentFolder);
  return separator + path.join(separator);
}

// Converts date to readable date format
function formatDate(date) {
  return moment(date).format("Do MMM YYYY");
}

// Remove any selected field
function removeSelection() {
  $('.file-row input[type="checkbox"]').each(function () {
    var $item = $(this);
    $item.prop('checked', false);
    $item.parents('.file-row').removeClass('active');
    $('.file-cell.selectable').removeClass('active');
    $('.file-row').removeClass('passive');
  });
}

// Hide side action menu
function hideSideActions() {
  $('.side-actions').removeClass('active');
  $('.side-actions .item').removeClass('show');
  $('.help-tips').removeClass('hidden');
}

function updateBreadcrumbsBySearchItem(item) {
  if (!item) {
    return;
  }

  var tempNav = [];
  var isLast = false;

  var getParents = function (parent) {
    if (parent.parentFolder) {
      getParents(parent.parentFolder);
    } else {
      isLast = true;
    }

    if (isLast && parent.id === +currentFolderId) {
      return;
    }

    tempNav.push({
      id: parent.id,
      name: parent.name,
      type: 'folderId',
      back: function () {
        getFolderContentsById(parent.id, 'folder');
      }
    });
  };

  getParents(item);

  navStack = navStack.concat(tempNav);
  updatePaths();
}

function enableSearchState() {
  $folderContents.empty();
  $fileTable.addClass('search-result');
  $('.new-btn').addClass('hide');
  showNothingFoundAlert(false);
  beforeSearchNavStack = navStack;
}

function disableSearchState() {
  $fileTable.removeClass('search-result');
  $searchTerm.val('');
  $searchType.val('this-folder');
  $('.new-btn').removeClass('hide');
  showNothingFoundAlert(false);
  if (!$pagination.is(':empty')) {
    $pagination.pagination('destroy');
  }
}

// Shows content of the last folder before run search
function backToLastFolderBeforeSearch() {
  var navItem = _.last(beforeSearchNavStack);
  navItem.back();
  navStack = beforeSearchNavStack;
  updatePaths();
}

function showNothingFoundAlert(isShow){
  if(isShow){
    $('.search-empty-state').addClass('active');
  }else{
    $('.search-empty-state').removeClass('active');
  }
}

function showAlertWithButtonGoToFolder(item, area) {
  var goToButton = $('#alert-btn-action').attr('data-type', area.type);

  if (area.type == 'organization') {
    goToButton.attr('data-id', area.orgId);
  } else if (area.type == 'app') {
    goToButton.attr('data-id', area.appId);
  } else {
    goToButton.attr('data-id', area.id);
  }

  $('.alert-action').addClass('active');
  $('.alert-message').text(item.length + ' item(s) moved');
  setTimeout(function() {
    setAlertVisibilityWhenMovingItems(false);
  }, 5000);
}

// Check items if they are checked before moving
function checkDraggedFileIfSelected(draggedItem, selectedItems) {
  var res = false;
  if (!selectedItems.length) {
    return false;
  }
  for (var i = 0; i <= selectedItems.length; i++) {
    if($(selectedItems[i]).attr('data-id') == draggedItem.id) {
      res = true;
      break;
    }
  }
  return res;
}

// Change opacity when moving folders or files
function setOpacityWhenMovingItems(item) {
  $(item).css({ opacity: '0.3' }).removeClass('active');
}

// Create object for moving Items
function moveItem(dropZone, isFolder) {
  var movedPlace = {};
  var parent = isFolder ? 'parentId' : 'mediaFolderId';
  if (dropZone.type === 'organization') {
    movedPlace.appId = null;
    movedPlace[parent] = null;
    movedPlace.organizationId = dropZone.orgId;
  } else if (dropZone.type === 'app') {
    movedPlace.appId = dropZone.appId;
    movedPlace[parent] = null;
  } else if (dropZone.fileType === 'folder') {
    movedPlace[parent] = dropZone.id;
  } else {
    return false;
  }
  return movedPlace;
}

function moveItems(folderType, id, dropArea, element, items) {
  if (folderType === 'folder') {
    Fliplet.Media.Folders.update(id, moveItem(dropArea, true)).then(function(response) {
      if (response.folder) {
        element.remove();
        if(items) {
          showAlertWithButtonGoToFolder(items, dropArea);
        } else {
          showAlertWithButtonGoToFolder(element, dropArea);
        }
        hideSideActions();

      }
    });
  } else {
    Fliplet.Media.Files.update(id, moveItem(dropArea, false)).then(function(response) {
      if (response.file) {
        element.remove();
        if(items) {
          showAlertWithButtonGoToFolder(items, dropArea);
        } else {
          showAlertWithButtonGoToFolder(element, dropArea);
        }
        hideSideActions();
      }
    });
  }
}

function setAlertVisibilityWhenMovingItems(isShow) {
  if (isShow) {
    $('.alert-action').removeClass('active');
    $('.alert-wrapper').addClass('active');
  } else {
    $('.alert-wrapper').removeClass('active');
    $('#alert-btn-action').removeAttr('data-type');
  }
}

// Go to folder where dropped items
$('#alert-btn-action').on('click', function() {
  var $button = $(this);
  var dataType = $button.attr('data-type');
  var dataIdAttribute = $button.attr('data-id');

  if (dataType == 'organization') {
    $('.list-holder[data-org-id="' + dataIdAttribute + '"]').click();
    setAlertVisibilityWhenMovingItems(false);
  } else if (dataType == 'app') {
    $('.app-holder[data-app-id="' + dataIdAttribute + '"]').click();
    setAlertVisibilityWhenMovingItems(false);
  } else {
    $('.file-row[data-id="' + dataIdAttribute + '"]').find('.file-name').dblclick();
    $('.header-breadcrumbs  [data-id="' + dataIdAttribute + '"] [data-breadcrumb]').click();
    setAlertVisibilityWhenMovingItems(false);
  }
});

$dropZone.on('drop', function(e) {
  e.preventDefault();
  hideDropZone();
  var dataTransfer = e.originalEvent.dataTransfer;
  var files = dataTransfer.files;
  if (!files.length) return hideDropZone();
  uploadFiles(files);
});

$dropZone.on('dragover', function(e) {
  e.preventDefault();
});

$dropZone.on('dragleave', function(e) {
  e.preventDefault();
  hideDropZone();
});

$('html').on('dragenter', function(e) {
  e.preventDefault();
  if(e.originalEvent.dataTransfer.files.length === 0) {
    hideDropZone();
    return;
  }
  showDropZone();
});

// EVENTS //
// Removes options popup by clicking elsewhere
$(document).on("click", function(e) {
    if ($(e.target).is(".new-menu") === false && $(e.target).is("ul") === false) {
      $('.new-menu').removeClass('active');
    }
  })
  .mouseup(function(e) {
    $(document).unbind('mousemove');
  });

$('.file-manager-wrapper')
  .on('change', '#file_upload', function() {
    var $form = $('[data-upload-file]');

    $form.submit();

    $('.new-btn').click();
  })
  .on('dblclick', '.file-table-body [data-browse-folder], .file-table-body [data-open-file]', function(event) {
    var $el = $(this);
    var $parent = $el.parents('.file-row');
    var id = $el.parents('.file-row').data('id');
    var backItem;

    removeSelection();
    hideSideActions();
    disableSearchState();

    if ($parent.data('file-type') === 'folder') {
      // Store to nav stack
      backItem = _.find(folders, ['id', id]);
      backItem.tempElement = $('.file-row[data-id="' + id + '"]');
      backItem.back = function() {
        getFolderContents(backItem.tempElement);
      };
      backItem.type = 'folderId';
      navStack.push(backItem);

      // Update paths
      updatePaths();
      getFolderContents($(this).parents('.file-row'));
    } else {
      var fileURL = $('.file-row[data-id="' + id + '"]').attr('data-file-url');

      if (fileURL !== undefined) {
        window.open(fileURL, '_blank');
      }
    }
  })
  .on('click', '.dropdown-menu-holder [data-browse-folder]', function(event) {
    disableSearchState();
    resetUpTo($(this));
    getFolderContents($(this), true);
  })
  .on('click', '[data-create-folder]', function(event) {
    // Creates folder
    var folderName = prompt('Type folder name');
    var lastFolderSelected = navStack[navStack.length - 1];

    var options = {
      name: folderName,
      parentId: currentFolderId || undefined
    };

    if (!folderName) {
      return;
    }

    if (lastFolderSelected.type === "appId") {
      options.appId = lastFolderSelected.id;
    } else if (lastFolderSelected.type === "organizationId") {
      options.organizationId = lastFolderSelected.id;
    } else {
      options.parentId = lastFolderSelected.id;

      if (lastFolderSelected.organizationId !== null) {
        options.organizationId = lastFolderSelected.organizationId;
      } else if (lastFolderSelected.appId !== null) {
        options.appId = lastFolderSelected.appId;
      }
    }

    Fliplet.Media.Folders.create(options).then(function (folder) {
      addFolder(folder);
      insertItem(folder, true);
    });

    $('.new-btn').click();
  })
  .on('submit', '[data-upload-file]', function(event) {
    // Upload file
    event.preventDefault();

    var formData = new FormData();
    var $form = $(this);
    var $input = $form.find('input');
    var files = $input[0].files;
    var file;

    for (var i = 0; i < files.length; i++) {
      file = files.item(i);
      formData.append('name[' + i + ']', file.name);
      formData.append('files[' + i + ']', file);
    }

    $progressBar.css({
      width: '0%'
    });
    $progress.removeClass('hidden');

    Fliplet.Media.Files.upload({
      folderId: currentFolderId,
      appId: currentAppId,
      name: file.name,
      data: formData,
      progress: function(percentage) {
        $progressBar.css({
          width: percentage + '%'
        });
      }
    }).then(function(files) {
      $input.val('');
      files.forEach(function(file) {
        addFile(file);
        insertItem(file);
      });

      $progress.addClass('hidden');
    });
  })
  .on('change', '#sort-files', function() {
    var selectedValue = $(this).val();
    var selectedText = $(this).find("option:selected").text();
    $(this).parents('.select-proxy-display').find('.select-value-proxy').html(selectedText);
  })
  .on('click', '.new-btn', function(event) {
    $(this).next('.new-menu').toggleClass('active');

    event.stopPropagation();
  })
  .on('click', '.file-row > div:not(.selectable)', function() {
    $(this).parents('.file-table-body').find('.file-row.active input[type="checkbox"]').click();
    $(this).parents('.file-row').find('input[type="checkbox"]').click();
  })
  .on('change', '.file-row input[type="checkbox"]', function() {
    $(this).parents('.file-row').toggleClass('active');
    checkboxStatus();
  })
  .on('change', '.file-table-header input[type="checkbox"]', function() {
    toggleAll($(this));
  })
  .on('click', '[delete-action]', function() {
    var items = $('.file-row.active');

    var alertConfirmation = confirm("Are you sure you want to delete all selected items?\nAll the content inside a folder will be deleted too.");

    if (alertConfirmation === true) {
      $(items).each(function() {
        var $element = $(this);

        var itemID = $element.attr('data-id');
        if ($element.attr('data-file-type') === 'folder') {
          Fliplet.Media.Folders.delete(itemID).then(function() {
            $element.remove();
            checkboxStatus();

            currentFolders = currentFolders.filter(function(folder){
              return folder.id != itemID;
            });

            // Toggle checkbox header to false
            $('.file-table-header input[type="checkbox"]').prop('checked', false);
            $('.file-cell.selectable').css({'opacity': '0', 'visibility': 'hidden'});
          });
        } else {
          Fliplet.Media.Files.delete(itemID).then(function() {
            $element.remove();
            checkboxStatus();

            currentFiles = currentFiles.filter(function(file){
              return file.id != itemID;
            });

            // Toggle checkbox header to false
            $('.file-table-header input[type="checkbox"]').prop('checked', false);
            $('.file-cell.selectable').css({'opacity': '0', 'visibility': 'hidden'});
          });
        }
      });
    }
  })
  .on('click', '[download-action]', function() {
    var items = $('.file-row.active'),
        context = navStack[navStack.length - 1],
        contextType = context.type,
        contextId = context.id,
        files,
        folders,
        params = '',
        contentToZip = {
          files: [],
          folders: []
        };

    $(items).each(function() {
      var $element = $(this);

      if ($element.attr('data-file-type') === 'folder') {
        contentToZip.folders.push($element.attr('data-id'));
      } else {
        contentToZip.files.push($element.attr('data-id'));
      }
    });

    if (contentToZip.files.length) {
      files = contentToZip.files.toString();
      params += '&files=' + files;
    }
    if (contentToZip.folders.length) {
      folders = contentToZip.folders.toString();
      params += '&folders=' + folders;
    }

    window.location.href = '/v1/media/zip?' + contextType + '=' + contextId + params;
  })
  .on('click', '[open-action]', function() {
    // Open folder or file
    var itemID = $('.file-row.active').data('id');
    var fileURL = $('.file-row.active').data('file-url');

    if (fileURL !== undefined) {
      window.open(fileURL, '_blank');
    } else {
      $('.file-row.active').find('.file-name').dblclick();
    }
  })
  .on('click', '[rename-action]', function() {
    // Rename folder or file
    var itemID = $('.file-row.active').data('id');
    var itemType = $('.file-row.active').data('file-type');
    var fileName = $('.file-row[data-id="' + itemID + '"]').find('.file-name span').text();

    var changedName = prompt("Please enter the file name", fileName);

    if (changedName !== null) {
      if (itemType === "folder") {
        Fliplet.Media.Folders.update(itemID, {
          name: changedName
        }).then(function() {
          $('.file-row[data-id="' + itemID + '"]').find('.file-name span').html(changedName);

          var folder = _.find(currentFolders, ['id', itemID]);
          folder.name = changedName;
        });
      } else {
        Fliplet.Media.Files.update(itemID, {
          name: changedName
        }).then(function() {
          $('.file-row[data-id="' + itemID + '"]').find('.file-name span').html(changedName);

          var file = _.find(currentFiles, ['id', itemID]);
          file.name = changedName;
        });
      }
    }
  })
  .on('click', '.header-breadcrumbs [data-breadcrumb]', function() {
    var index = $(this).data('breadcrumb');
    var position = index + 1;

    navStack.splice(position, 9999);
    navStack[index].back();
    updatePaths();
  })
  .on('show.bs.collapse', '.panel-collapse', function() {
    $(this).siblings('.panel-heading').find('.fa').addClass('rotate');
  })
  .on('hide.bs.collapse', '.panel-collapse', function() {
    $(this).siblings('.panel-heading').find('.fa').removeClass('rotate');
  })
  .on('keyup', '.search-term', _.debounce(function(){
    var term = $searchTerm.val();

    if (!term) {
      disableSearchState();
      backToLastFolderBeforeSearch();
      return;
    }

    removeSelection();
    hideSideActions();

    var type = $searchType.val();
    search(type, term)
      .catch(function () {
        alert('Error on search files');
      });

  }, searchDebounceTime))
  .on('click', '.path-link', function () {
    var $el = $(this);
    var type = $el.data('type');
    var id = $el.data('id');

    if (type === 'app' || type === 'organization') {
      resetToTop();
    } else {
      var item = _.find(currentSearchResult, ['id', id]);
      updateBreadcrumbsBySearchItem(item);
    }

    getFolderContentsById(id, type, true);

    removeSelection();
    hideSideActions();
    disableSearchState();
  })
  .on('change', '.search-type', function(){
    if(!$searchTerm.val()){
      return;
    }

    var type = $searchType.val();
    if(type === 'all'){
      currentFolderId = null;
    }

    $searchTerm.keyup();
  })
  .on('dragstart', '.file-row', function(e) {
    var dragingItem = $(e.target).data();
    e.originalEvent.dataTransfer.setData('text', JSON.stringify(dragingItem));
    $('.panel-title.list-holder').addClass('drop-area');
    $('.app-holder').addClass('drop-area');
    $('.file-row[data-file-type="folder"]').each(function() {
      var item = $(this);
      if (dragingItem.id != item[0].dataset.id && !$(item).hasClass('active')) {
        $(item).addClass('drop-area');
      }
    });
    $('.bread-link').addClass('drop-area').last().removeClass('drop-area');
  })
  .on('dragend', function(e) {
    $('.panel-title.list-holder').removeClass('drop-area');
    $('.app-holder').removeClass('drop-area');
    $('.file-row[data-file-type="folder"]').removeClass('drop-area');
    $('.bread-link').removeClass('drop-area');
  })
  .on('drop', '.drop-area', function(e) {
    e.preventDefault();
    var area = $(this);
    var dropArea = area.data();
    var items = $('.file-row.active');
    var itemType = JSON.parse(e.originalEvent.dataTransfer.getData('text'));
    var $element = $('.file-row[data-id=' + itemType.id + ']');
    var checkDraggedItems = checkDraggedFileIfSelected(itemType, items);
    var alertConfirmationMovingItem = confirm('Are you sure you want to move item(s)?');

    if (alertConfirmationMovingItem === true) {
      setOpacityWhenMovingItems($element);

      // Show alert when moving item(s)
      setAlertVisibilityWhenMovingItems(true);

      if (checkDraggedItems) {
        $('.alert-message').text('Moving ' + items.length + ' items...');
        $(items).each(function() {
          var $element = $(this);
          var folderType = $element.attr('data-file-type');
          var itemId = $element.attr('data-id');
          setOpacityWhenMovingItems($element);
          moveItems(folderType, itemId, dropArea, $element, items);
        });
      } else {
        $('.alert-message').text('Moving ' + $element.length + ' items...');
        moveItems(itemType.fileType, itemType.id, dropArea, $element);
      }
    }
  })
  .on('dragover', '.drop-area', function(e) {
    e.preventDefault();
  });

/* Resize sidebar
.on('mousedown', '.split-bar', function(e) {
  e.preventDefault();
  $(document).mousemove(function(e) {
    e.preventDefault();
    var x = e.pageX - $('.file-manager-leftside').offset().left;
    if (x > sideBarMinWidth && x < sideBarMaxWidth) {
      $('.file-manager-leftside').css("width", x);
    }
  });
});
*/

// INIT //
getOrganizationsList();
