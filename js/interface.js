
var widgetId = Fliplet.Widget.getDefaultId();
var data = Fliplet.Widget.getData(widgetId) || {};
var organizationId = Fliplet.Env.get('organizationId');
var validInputEventName = 'interface-validate';

var $dataSource = $('#dataSource');
var allDataSources;
var currentDataSource;
var initialLoadingDone = false;

var templates = {
  dataSourceEntry: template('data-source-entry')
};

var defaultEmailTemplate = $('#email-template-default').html();

var fields = [
  'dataSource',
  'emailColumn',
  'passColumn',
  'emailTemplate'
];

var linkData = $.extend(true, {
  action: 'screen',
  page: '',
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
  onEvent: function (event, data) {
    if (event === 'interface-validate') {
      Fliplet.Widget.toggleSaveButton(data.isValid === true);
    }
  }
});

var tempColumnValues = {
  emailColumn: data['emailColumn'],
  passColumn : data['passColumn']
}

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
  setup : function(editor) {
    editor.on('init', function() {
      if ("emailTemplate" in data && data.emailTemplate !== "") {
        tinymce.get('validationEmail').setContent(data.emailTemplate);
      } else {
        tinymce.get('validationEmail').setContent(defaultEmailTemplate);
      }
    });
    editor.on('keyup paste', function(e) {
      data.emailTemplate = editor.getContent();
    });
  }
});

// 1. Fired from Fliplet Studio when the external save button is clicked
Fliplet.Widget.onSaveRequest(function () {
  $('form').submit();
});

// 2. Fired when the user submits the form
$('form').submit(function (event) {
  event.preventDefault();
  loginActionProvider.forwardSaveRequest();
});

// 3. Fired when the provider has finished
loginActionProvider.then(function (result) {
  data.loginAction = result.data;
  save(true);
});

// Function to compile a Handlebars template
function template(name) {
  return Handlebars.compile($('#template-' + name).html());
}

function save(notifyComplete) {
  // Get and save values to data
  _.forEach(fields, function (fieldId) {
    data[fieldId] = $('#' + fieldId).val();
  });

  var updateDataSource = Promise.resolve();

  if (currentDataSource) {
    var definition = currentDataSource.definition || {};
    var validation = {
      email: {
        domain: false,
        expire: "60",
        domains: [],
        template: {
          to: [],
          html: data.emailTemplate || defaultEmailTemplate,
          subject: "Validate your email address"
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
    return Fliplet.Widget.save(data).then(function () {
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

Fliplet.DataSources.get({ organizationId: organizationId, appId: Fliplet.Env.get('appId') }).then(function (dataSources) {
  allDataSources = dataSources || [];
  $dataSource.html('<option value="">-- Select a data source</option><option disabled>------</option><option value="new">Create a new data source</option><option disabled>------</option>');
  _.forEach(dataSources, renderDataSource);
  return Promise.resolve();
}).then(initializeData);

function reloadDataSource(dataSourceId) {
  Fliplet.DataSources.get({ organizationId: organizationId, appId: Fliplet.Env.get('appId') }, {cache: false}).then(function (dataSources) {
    allDataSources = dataSources || [];
    $dataSource.html('<option value="">-- Select a data source</option><option disabled>------</option><option value="new">Create a new data source</option><option disabled>------</option>');
    _.forEach(dataSources, renderDataSource);
    return Promise.resolve();
  }).then(function() {
    $dataSource.val(dataSourceId);
    $dataSource.trigger('change');
  });
}

function renderDataSource(dataSource){
  $dataSource.append(templates.dataSourceEntry(dataSource));
}

function renderDataSourceColumn(dataSourceColumn){
  $('#emailColumn').append('<option value="'+dataSourceColumn+'">'+dataSourceColumn+'</option>');
  $('#passColumn').append('<option value="'+dataSourceColumn+'">'+dataSourceColumn+'</option>');
}

function createDataSource() {
  event.preventDefault();
  var name = prompt('Please type a name for your data source:');

  if (name === null) {
    $dataSource.val('').trigger('change');
    return;
  }

  if (name === '') {
    $dataSource.val('').trigger('change');
    alert('You must enter a data source name');
    return;
  }

  Fliplet.DataSources.create({
    name: name,
    organizationId: Fliplet.Env.get('organizationId')
  }).then(function(ds) {
    allDataSources.push(ds);
    $dataSource.append('<option value="' + ds.id + '">' + ds.name + '</option>');
    $dataSource.val(ds.id).trigger('change');
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

function syncTempColumns(columnType){
  tempColumnValues[columnType] = $('#'+columnType).val();
}

Fliplet.Studio.onMessage(function(event) {
  if (event.data && event.data.event === 'overlay-close') {
    reloadDataSource(event.data.data.dataSourceId);
  }
});

$('#manage-data a').on('click', manageAppData);

$dataSource.on('change', function onDataSourceListChange() {
  var selectedOption = $(this).find("option:selected"),
      selectedText = selectedOption.text(),
      selectedValue = selectedOption.val();

  $(this).parents('.select-proxy-display').find('.select-value-proxy').html(selectedText);
  $('#emailColumn option:gt(0)').remove();
  $('#passColumn option:gt(0)').remove();

  if ( $(this).val() === "new" ) {
    createDataSource();
  }

  if ( $(this).val() !== "none" ) {
    $('#manage-data').removeClass('hidden');
    $('#select-email-field').removeClass('hidden');
    $('#select-pass-field').removeClass('hidden');
  } else {
    $('#manage-data').addClass('hidden');
    $('#select-email-field').addClass('hidden');
    $('#select-pass-field').addClass('hidden');
  }

  _.forEach(allDataSources, function(dataSource){
    if(dataSource.id == selectedValue && typeof dataSource.columns !== "undefined") {
      currentDataSource = dataSource;
      _.forEach(dataSource.columns, renderDataSourceColumn);
      $('#emailColumn').val(tempColumnValues.emailColumn).trigger('change');
      $('#passColumn').val(tempColumnValues.passColumn).trigger('change');
    }
  });
});

$('#emailColumn, #passColumn').on('change', function() {
  var selectedValue = $(this).val();
  var selectedText = $(this).find("option:selected").text();
  $(this).parents('.select-proxy-display').find('.select-value-proxy').html(selectedText);

  syncTempColumns($(this).attr('id'));

  Fliplet.Widget.emit(validInputEventName, {
    isValid: selectedValue !== 'none'
  });
});

$('#allow_reset').on('change', function() {
  if ($(this).prop('checked')) {
    $('.reset-pass-redirect').removeClass('hidden');
    data.allowReset = true;
  } else {
    $('.reset-pass-redirect').addClass('hidden');
    data.allowReset = false;
  }

  if (initialLoadingDone) {
    save();
  }

  initialLoadingDone = true;
});

$('#help_tip').on('click', function() {
  alert("During beta, please use live chat and let us know what you need help with.");
});

function initializeData() {
  _.forEach(fields, function (fieldId) {
    if (data[fieldId]) {
      $('#' + fieldId).val(data[fieldId]).change();
    }
  });

  if (data.allowReset) {
    $('#allow_reset').trigger('change');
  }
}
