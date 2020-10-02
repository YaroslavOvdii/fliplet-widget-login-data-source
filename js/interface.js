
var widgetId = Fliplet.Widget.getDefaultId();
var data = Fliplet.Widget.getData(widgetId) || {};
var organizationId = Fliplet.Env.get('organizationId');
var appId = Fliplet.Env.get('appId');
var validInputEventName = 'interface-validate';
var page = Fliplet.Widget.getPage();
var omitPages = page ? [page.id] : [];

var $dataSource = $('#dataSource');
var allDataSources;
var currentDataSource;
var initialLoadingDone = false;
var defaultExpireTimeout = 2880;

var templates = {
  dataSourceEntry: template('data-source-entry')
};

var defaultEmailTemplate = $('#email-template-default').html();

var fields = [
  'dataSource',
  'emailColumn',
  'passColumn',
  'expireTimeout'
];

var linkData = $.extend(true, {
  action: 'screen',
  page: '',
  omitPages: omitPages,
  transition: 'fade',
  options: {
    hideAction: true
  }
}, data.loginAction);

var loginActionProvider = Fliplet.Widget.open('com.fliplet.link', {
  // If provided, the iframe will be appended here,
  // otherwise will be displayed as a full-size iframe overlay
  selector: '#login-link-action',
  // Also send the data I have locally, so that
  // the interface gets repopulated with the same stuff
  data: linkData,
  // Events fired from the provider
  onEvent: function(event, data) {
    if (event === 'interface-validate') {
      Fliplet.Widget.toggleSaveButton(data.isValid === true);
    }
  }
});

var tempColumnValues = {
  emailColumn: data['emailColumn'],
  passColumn: data['passColumn']
};

// TinyMCE INIT
tinymce.init({
  selector: '#validationEmail',
  plugins: [
    'lists advlist image charmap hr code',
    'searchreplace wordcount insertdatetime table textcolor colorpicker'
  ],
  toolbar: [
    'formatselect |',
    'bold italic underline strikethrough |',
    'forecolor backcolor |',
    'alignleft aligncenter alignright alignjustify | bullist numlist outdent indent |',
    'blockquote subscript superscript | table insertdatetime charmap hr |',
    'removeformat | code'
  ].join(' '),
  menubar: false,
  statusbar: false,
  min_height: 300,
  setup: function(editor) {
    editor.on('init', function() {
      if ('emailTemplate' in data && data.emailTemplate !== '') {
        tinymce.get('validationEmail').setContent(data.emailTemplate);
      } else {
        tinymce.get('validationEmail').setContent(defaultEmailTemplate);
        data.emailTemplate = defaultEmailTemplate;
      }
    });
    editor.on('keyup paste', function() {
      data.emailTemplate = editor.getContent();
    });
  }
});

// 1. Fired from Fliplet Studio when the external save button is clicked
Fliplet.Widget.onSaveRequest(function() {
  $('form').submit();
});

// 2. Fired when the user submits the form
$('form').submit(function(event) {
  event.preventDefault();
  loginActionProvider.forwardSaveRequest();
});

// 3. Fired when the provider has finished
loginActionProvider.then(function(result) {
  data.loginAction = result.data;
  save(true);
});

// Function to compile a Handlebars template
function template(name) {
  return Handlebars.compile($('#template-' + name).html());
}

// Converts minutes to hours or days or weeks
function setReadableExpirePeriod(value) {
  var timeInterval = '1';

  if (value % 60 === 0 && value > 0) {
    // Converts to hours
    value = value / 60;
    timeInterval = '60';

    if (value % 24 === 0) {
      // Converts to days
      value = value / 24;
      timeInterval = '1440';

      if (value % 7 === 0) {
        // Converts to weeks
        value = value / 7;
        timeInterval = '10080';
      }
    }
  }

  $('#expire-timeout').val(value);
  $('#time-value').val(timeInterval);
}

// Converts time to minutes depending on selected hours or days or weeks
function convertTimeToMinutes () {
  var inputValue = $('#expire-timeout').val();
  var selectValue = $('#time-value').val();
  return inputValue * selectValue;
}

// Shows warning if security setting are not configured correctly
function checkSecurityRules () {
  Fliplet.API.request('v1/apps/' + appId).then(function(result) {
    if (!result || !result.app) {
      return;
    }

    var hooks = _.get(result.app, 'hooks', []);
    var isSecurityConfigured = _.some(hooks, function(hook) {
      return hook.script.indexOf(page.id) !== -1;
    });
    
    if (!hooks.length) {
      $('#security-alert span').text('app has no security rules configured to prevent unauthorized access.');
    }

    $('#security-alert').toggleClass('hidden', isSecurityConfigured);
  })
}

function save(notifyComplete) {
  // Get and save values to data
  _.forEach(fields, function(fieldId) {
    if (fieldId === 'expireTimeout') {
      data[fieldId] = $('#expire-timeout').val() ? convertTimeToMinutes() : defaultExpireTimeout;
      return;
    }

    data[fieldId] = $('#' + fieldId).val();
  });

  var updateDataSource = Promise.resolve();

  if (currentDataSource) {
    var definition = currentDataSource.definition || {};
    var validation = {
      email: {
        domain: false,
        expire: convertTimeToMinutes(),
        domains: [],
        template: {
          to: [],
          html: data.emailTemplate || defaultEmailTemplate,
          subject: 'Validate your email address'
        },
        toColumn: data.emailColumn,
        matchColumn: data.emailColumn
      }
    };
    definition.validation = validation;

    // Update definition to make sure the password never gets sent
    // to apps when fetching data for this dataSource.
    if (data.passColumn) {
      if (!Array.isArray(definition.exclude)) {
        definition.exclude = [];
      }

      definition.exclude = _.compact(_.uniq(definition.exclude.concat([data.passColumn])));
    }

    // Update data source definitions
    var options = { id: data.dataSource, definition: definition };
    updateDataSource = Fliplet.DataSources.update(options);
  }

  return updateDataSource.then(function() {
    return Fliplet.Widget.save(data).then(function() {
      if (notifyComplete) {
        Fliplet.Widget.complete();
        window.location.reload();
      } else {
        Fliplet.Studio.emit('reload-widget-instance', widgetId);
      }
    });
  });
}

Fliplet.Widget.emit(validInputEventName, {
  isValid: false
});

Fliplet.DataSources.get({ organizationId: organizationId, appId: appId }).then(function(dataSources) {
  allDataSources = dataSources || [];
  $dataSource.html('<option value="">-- Select a data source</option><option disabled>------</option><option value="new">Create a new data source</option><option disabled>------</option>');
  _.forEach(dataSources, renderDataSource);
  return Promise.resolve();
}).then(initializeData);

function reloadDataSource(dataSourceId) {
  Fliplet.DataSources.get({ organizationId: organizationId, appId: appId }, {cache: false}).then(function(dataSources) {
    allDataSources = dataSources || [];
    $dataSource.html('<option value="">-- Select a data source</option><option disabled>------</option><option value="new">Create a new data source</option><option disabled>------</option>');
    _.forEach(dataSources, renderDataSource);
    return Promise.resolve();
  }).then(function() {
    $dataSource.val(dataSourceId);
    $dataSource.trigger('change');
  });
}

function renderDataSource(dataSource) {
  $dataSource.append(templates.dataSourceEntry(dataSource));
}

function renderDataSourceColumn(dataSourceColumn) {
  $('#emailColumn').append('<option value="' + dataSourceColumn + '">' + dataSourceColumn + '</option>');
  $('#passColumn').append('<option value="' + dataSourceColumn + '">' + dataSourceColumn + '</option>');
}

function createDataSource() {
  event.preventDefault();

  Fliplet.Modal.prompt({
    title: 'Please enter a data source name'
  }).then(function(result) {
    if (result === null) {
      $dataSource.val('').trigger('change');
      return;
    }

    var dataSourceName = result.trim();

    if (!dataSourceName) {
      Fliplet.Modal.alert({
        message: 'You must enter a data source name'
      }).then(function() {
        createDataSource();
        return;
      });
    }

    $('#manage-data').removeClass('hidden');
    $('#select-email-field').removeClass('hidden');
    $('#select-pass-field').removeClass('hidden');

    Fliplet.DataSources.create({
      name: dataSourceName,
      organizationId: Fliplet.Env.get('organizationId')
    }).then(function(ds) {
      allDataSources.push(ds);
      $dataSource.append('<option value="' + ds.id + '">' + ds.name + '</option>');
      $dataSource.val(ds.id).trigger('change');
    });
  });
}

function manageAppData() {
  var dataSourceId = $dataSource.val();
  Fliplet.Studio.emit('overlay', {
    name: 'widget',
    options: {
      size: 'large',
      package: 'com.fliplet.data-sources',
      title: 'Edit Data Sources',
      classes: 'data-source-overlay',
      data: {
        context: 'overlay',
        dataSourceId: dataSourceId
      }
    }
  });
}

function syncTempColumns(columnType) {
  tempColumnValues[columnType] = $('#' + columnType).val();
}

Fliplet.Studio.onMessage(function(event) {
  if (event.data && event.data.event === 'overlay-close') {
    reloadDataSource(event.data.data.dataSourceId || currentDataSource.id);
  }
});

$('#manage-data a').on('click', manageAppData);

$dataSource.on('change', function onDataSourceListChange() {
  var selectedOption = $(this).find('option:selected');
  var selectedText = selectedOption.text();
  var selectedValue = parseInt(selectedOption.val(), 10);
  var optionValue =  $(this).val();

  $(this).parents('.select-proxy-display').find('.select-value-proxy').html(selectedText);
  $('#emailColumn option:gt(0)').remove();
  $('#passColumn option:gt(0)').remove();

  if (optionValue === 'new') {
    createDataSource();
  }

  var dsSelected =  !optionValue || optionValue === 'none' || optionValue === 'new';

  $('#manage-data').toggleClass('hidden', dsSelected);
  $('#select-email-field').toggleClass('hidden', dsSelected);
  $('#select-pass-field').toggleClass('hidden', dsSelected);

  _.forEach(allDataSources, function(dataSource) {
    if (dataSource.id === selectedValue && dataSource.columns) {
      currentDataSource = dataSource;
      _.forEach(dataSource.columns, renderDataSourceColumn);

      var emainColumnValue = dataSource.columns.indexOf(tempColumnValues.emailColumn) !== -1 ? tempColumnValues.emailColumn : 'none';
      var passColumnValue = dataSource.columns.indexOf(tempColumnValues.passColumn) !== -1 ? tempColumnValues.passColumn : 'none';

      $('#emailColumn').val(emainColumnValue).trigger('change');
      $('#passColumn').val(passColumnValue).trigger('change');
    }
  });
});

$('#emailColumn, #passColumn').on('change', function() {
  var selectedValue = $(this).val();
  var selectedText = $(this).find('option:selected').text();
  $(this).parents('.select-proxy-display').find('.select-value-proxy').html(selectedText);

  syncTempColumns($(this).attr('id'));

  Fliplet.Widget.emit(validInputEventName, {
    isValid: selectedValue !== 'none'
  });
});

$('#allow_reset').on('change', function() {
  var checked = $(this).prop('checked');

  $('.reset-pass-redirect').toggleClass('hidden', !checked);
  $('.expire-timeout-settings').toggleClass('hidden', !checked);
  data.allowReset = checked;

  if (initialLoadingDone) {
    save();
  }

  initialLoadingDone = true;
});

// Open security overlay
$('#security-alert u').on('click', function() {
  Fliplet.Studio.emit('overlay', {
    name: 'app-settings',
    options: {
      title: 'App Settings',
      size: 'large',
      section: 'appSecurity',
      appId: appId
    }
  });
});

function initializeData() {
  checkSecurityRules();

  _.forEach(fields, function(fieldId) {
    if (fieldId === 'expireTimeout') {
      setReadableExpirePeriod(data[fieldId] || defaultExpireTimeout);
    } else if (data[fieldId]) {
      $('#' + fieldId).val(data[fieldId]).change();
    }
  });

  if (data.allowReset) {
    $('#allow_reset').trigger('change');
  }
}

// Preveting entering invalid values in the expiration input
$('#expire-timeout').on('keydown', function(event) {
  return event.keyCode === 8 || /[0-9]+/.test(event.key);
});
