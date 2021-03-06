var collectionCache = {};

FilterCollections = function (collection, settings) {
    if (!this instanceof FilterCollections) {
        return new FilterCollections(collection, settings);
    }

    var self = this;

    var _settings = settings || {};
    var _initialized = false;
    var _EJSONQuery = {};

    self._collection = collection || {};

    self.name = (_settings.name) ? _settings.name : self._collection._name;

    var _subscriptionResultsId = 'fc-' + self.name + '-results';
    var _subscriptionCountId = 'fc-' + self.name + '-count';
    var _useFilterDataOnly = !!_settings.useFilterDataOnly;

    var collectionCountName = self.name + 'CountFC';
    if (collectionCache[collectionCountName] === undefined) {
        collectionCache[collectionCountName] = self._collectionCount = new Mongo.Collection(collectionCountName);
    } else {
        self._collectionCount = collectionCache[collectionCountName];
    }

    var _deps = {
        initial_ready: new Tracker.Dependency(),
        query: new Tracker.Dependency(),
        sort: new Tracker.Dependency(),
        pager: new Tracker.Dependency(),
        filter: new Tracker.Dependency(),
        search: new Tracker.Dependency()
    };

    var _callbacks = {
        beforeSubscribe: (_settings.callbacks && _settings.callbacks.beforeSubscribe) ? _settings.callbacks.beforeSubscribe : null,
        afterSubscribe: (_settings.callbacks && _settings.callbacks.afterSubscribe) ? _settings.callbacks.afterSubscribe : null,
        beforeSubscribeCount: (_settings.callbacks && _settings.callbacks.beforeSubscribeCount) ? _settings.callbacks.beforeSubscribeCount : null,
        afterSubscribeCount: (_settings.callbacks && _settings.callbacks.afterSubscribeCount) ? _settings.callbacks.afterSubscribeCount : null,
        beforeResults: (_settings.callbacks && _settings.callbacks.beforeResults) ? _settings.callbacks.beforeResults : null,
        afterResults: (_settings.callbacks && _settings.callbacks.afterResults) ? _settings.callbacks.afterResults : null,
        templateCreated: (_settings.callbacks && _settings.callbacks.templateCreated) ? _settings.callbacks.templateCreated : null,
        templateRendered: (_settings.callbacks && _settings.callbacks.templateRendered) ? _settings.callbacks.templateRendered : null,
        templateDestroyed: (_settings.callbacks && _settings.callbacks.templateDestroyed) ? _settings.callbacks.templateDestroyed : null
    };

    var _template = _settings.template || {};

    var _sorts = (_settings.sort && _settings.sort.defaults) ? _settings.sort.defaults : [];
    var _sortOrder = (_settings.sort && _settings.sort.order) ? _settings.sort.order : ['asc', 'desc'];

    var _pager = {
        totalItems: 0,
        defaultOptions: (_settings.pager && _settings.pager.options) ? _settings.pager.options : [10, 20, 30, 40, 50],
        itemsPerPage: (_settings.pager && _settings.pager.itemsPerPage) ? parseInt(_settings.pager.itemsPerPage, 10) : 10,
        currentPage: (_settings.pager && _settings.pager.currentPage) ? parseInt(_settings.pager.currentPage, 10) : 1,
        showPages: (_settings.pager && _settings.pager.showPages) ? parseInt(_settings.pager.showPages, 10) : 10
    };

    var _filters = _settings.filters || {};

    var _subs = {
        results: {},
        count: {}
    };

    var _query = {
        selector: {},
        options: {}
    };

    var _autorun_handle;
    // FilterCollections is ready from e.g. Iron Router perspective
    var _initial_ready;

    /**
     * [_autorun description]
     * @return {[type]} [description]
     */
    var _autorun = function () {
        if (!_.isUndefined(_autorun_handle)) {
            return;
        }
        _autorun_handle = Tracker.autorun(function () {
            if (!_initialized) {
                self.sort.init(); // Set default query values for sorting.
                self.pager.init(); // Set defaul query values for paging.
                self.search.init(); // Set default searchable fields.
                _initialized = true;
            }

            var query = self.query.get();

            if (_.isFunction(_callbacks.beforeSubscribe)) {
                query = _callbacks.beforeSubscribe(query) || query;
            }

            _subs.results = Meteor.subscribe(_subscriptionResultsId, query, {
                onError: function (error) {
                    if (_.isFunction(_callbacks.afterSubscribe)) {
                        _callbacks.afterSubscribe(error, this);
                    }
                }
            });

            if (_subs.results.ready() && _.isFunction(_callbacks.afterSubscribe))
                _callbacks.afterSubscribe(null, this);

            if (_.isFunction(_callbacks.beforeSubscribeCount))
                query = _callbacks.beforeSubscribeCount(query) || query;

            _subs.count = Meteor.subscribe(_subscriptionCountId, query, {
                onError: function (error) {
                    if (_.isFunction(_callbacks.afterSubscribeCount)) {
                        _callbacks.afterSubscribeCount(error, this);
                    }
                }
            });

            if (_subs.count.ready()) {
                if (_.isFunction(_callbacks.afterSubscribeCount)) {
                    _callbacks.afterSubscribeCount(null, this);
                }

                var res = self._collectionCount.findOne({});
                self.pager.setTotals(res);
            }

            if (_subs.results.ready() && _subs.count.ready() && !_initial_ready) {
                _initial_ready = true;
                _deps.initial_ready.changed();
            }
        });
    };

    var FIELD_SPEC = 0;
    var ORDER_SPEC = 1;

    /**
     * [sort description]
     * @type {Object}
     */
    self.sort = {
        init: function () {
            this.run(false);
        },
        get: function () {
            _deps.sort.depend();

            var sortSpecification = {};
            _.each(_sorts, function (sort) {

                for (var parts = sort[FIELD_SPEC].split('.'), i = 0, length = parts.length, cache = sortSpecification; i < length; i++) {
                    if (!cache[parts[i]]) {
                        cache[parts[i]] = {};
                    }

                    var lastElement = i === length - 1;
                    if (lastElement) {
                        cache[parts[i]][sort[ORDER_SPEC]] = true;
                    }

                    cache = cache[parts[i]];
                }
            });

            return sortSpecification;
        },
        set: function (field, order, triggerUpdate) {
            field = field || "";
            order = order || _sortOrder[0];
            triggerUpdate = _.isUndefined(triggerUpdate) ? false : triggerUpdate;

            if (field) {
                var isNew = true;
                var isUpdate = false;

                _.each(_sorts, function (sort, idx) {
                    var value = _.indexOf(_sortOrder, sort[ORDER_SPEC]);

                    if (sort[0] === field) {
                        value = value + 1;
                        order = _sortOrder[value];
                        sort[ORDER_SPEC] = undefined;
                        isNew = false;
                        isUpdate = true;
                    }

                    if (!sort[1]) {
                        _sorts.splice(idx, 1);
                    }

                });

                if (isNew) {
                    _sorts.unshift([field, order]);
                }

                if (isUpdate && order) {
                    _sorts.unshift([field, order]);
                }
            }

            if (triggerUpdate) {
                this.run();
            }

            _deps.sort.changed();
        },
        run: function () {
            _query.options.sort = (!_.isEmpty(_sorts)) ? _sorts : [];
            self.query.set(_query);
        },
        clear: function (triggerUpdate) {
            _sorts = [];
            _query.options.sort = [];

            triggerUpdate = _.isUndefined(triggerUpdate) ? true : triggerUpdate;

            if (triggerUpdate) {
                this.run();
            }
        }
    };

    /**
     * [pager description]
     * @type {Object}
     */
    self.pager = {
        init: function () {
            _query.options.skip = this.getOffsetStart();
            _query.options.limit = _pager.itemsPerPage;

            self.query.set(_query);
        },
        get: function () {
            _deps.pager.depend();
            return _pager;
        },
        set: function (triggerUpdate) {
            triggerUpdate = _.isUndefined(triggerUpdate) ? false : triggerUpdate;

            var pages = this.getPages();
            var options = this.getOptions();
            var offsetStart = this.getOffsetStart();
            var offsetEnd = this.getOffsetEnd();

            _pager = _.extend(_pager, {
                pages: pages,
                options: options,
                offsetStart: offsetStart,
                offsetEnd: offsetEnd
            });

            if (triggerUpdate) {
                this.run();
            }

            _deps.pager.changed();
        },
        run: function () {
            _query.options.skip = _pager.offsetStart;
            _query.options.limit = _pager.itemsPerPage;
            self.query.set(_query);
        },
        setItemsPerPage: function (itemsPerPage, triggerUpdate) {
            triggerUpdate = _.isUndefined(triggerUpdate) ? false : triggerUpdate;

            _pager.itemsPerPage = parseInt(itemsPerPage, 10);

            if (triggerUpdate) {
                this.set(true);
            }
        },
        setCurrentPage: function (page, triggerUpdate) {
            triggerUpdate = _.isUndefined(triggerUpdate) ? false : triggerUpdate;

            _pager.currentPage = parseInt(page, 10);

            if (triggerUpdate) {
                this.set(true);
            }
        },
        getOptions: function () {
            var options = [];
            var totalItems = _pager.totalItems;
            var appendLast = false;
            var selected = false;

            _.each(_pager.defaultOptions, function (value) {
                if (totalItems >= value) {
                    selected = _pager.itemsPerPage === value;
                    options.unshift({
                        value: value,
                        status: (selected) ? 'selected' : ''
                    });
                } else {
                    appendLast = true;
                }
            });

            if (appendLast) {
                options.unshift({
                    value: totalItems,
                    status: (selected) ? 'selected' : ''
                });
            }

            return options;
        },
        getOffsetStart: function () {
            return (_pager.currentPage - 1) * _pager.itemsPerPage;
        },
        getOffsetEnd: function () {
            var offsetEnd = this.getOffsetStart() + _pager.itemsPerPage;
            return (offsetEnd > _pager.totalItems) ? _pager.totalItems : offsetEnd;
        },
        getPages: function () {
            var pages = [];

            var totalPages = _pager.totalPages;
            var currentPage = _pager.currentPage;
            var showPages = _pager.showPages;

            var start = (currentPage - 1) - Math.floor(showPages / 2);
            if (start < 0) {
                start = 0;
            }
            var end = start + showPages;
            if (end > totalPages) {
                end = totalPages;
                start = end - showPages;
                if (start < 0) {
                    start = 0;
                }
            }

            for (var i = start; i < end; i++) {
                var status = (currentPage === i + 1) ? 'active' : '';
                pages.push({
                    page: i + 1,
                    status: status
                });
            }

            return pages;
        },
        setTotals: function (res) {
            _pager.totalItems = res.count;
            _pager.totalPages = Math.ceil(_pager.totalItems / _pager.itemsPerPage);
            self.pager.set();
        },
        hasPrevious: function () {
            return (_pager.currentPage > 1);
        },
        hasNext: function () {
            return (_pager.currentPage < _pager.totalPages);
        },
        moveTo: function (page) {
            if (_pager.currentPage !== page) {
                _pager.currentPage = page;
                self.pager.set(true);
            }
        },
        movePrevious: function () {
            if (this.hasPrevious()) {
                _pager.currentPage--;
                this.set(true);
            }
        },
        moveFirst: function () {
            if (this.hasPrevious()) {
                _pager.currentPage = 1;
                this.set(true);
            }
        },
        moveNext: function () {
            if (this.hasNext()) {
                _pager.currentPage++;
                this.set(true);
            }
        },
        moveLast: function () {
            if (this.hasNext()) {
                _pager.currentPage = _pager.totalPages;
                this.set(true);
            }
        }
    };

    /**
     * [filter description]
     * @type {Object}
     */
    self.filter = {
        get: function () {
            _deps.filter.depend();
            return EJSON.clone(_filters);
        },
        set: function (filterField, filterSettings, triggerUpdate) {
            triggerUpdate = _.isUndefined(triggerUpdate) ? true : triggerUpdate;

            if (!_.has(_filters, filterField)) {
                throw new Error("Filter Collection Error: " + filterField + " is not a valid filter.");
            }

            _filters[filterField] = _.extend(_filters[filterField], filterSettings);

            // If a value is defined, this filter is active
            _filters[filterField].active = !!_filters[filterField].value;

            if (triggerUpdate) {
                this.run();
            }

            _deps.filter.changed();
        },
        getSelector: function () {
            var selector = {};
            var condition = {};

            _.each(_filters, function (filter, key) {
                if (filter.value) {
                    var segment = {};
                    var value;
                    segment[key] = {};

                    if (filter.value && filter.transform && _.isFunction(filter.transform)) {
                        value = filter.transform(filter.value);
                    } else {
                        value = filter.value;
                    }

                    if (filter.operator && filter.operator[0]) {
                        segment[key][filter.operator[0]] = value;
                        if (filter.operator[1]) {
                            segment[key].$options = filter.operator[1];
                        }
                    } else {
                        segment[key] = value;
                    }

                    if (!_.isEmpty(filter.condition)) {
                        condition[filter.condition] = condition[filter.condition] || [];
                        condition[filter.condition].push(segment);
                    }

                    if (filter.sort && _.indexOf(_sortOrder, filter.sort) !== -1) {
                        self.sort.clear(true);
                        self.sort.set(key, filter.sort, true);
                    }

                    var append = (!_.isEmpty(condition)) ? condition : segment;
                    selector = _.extend(selector, append);
                }
            });
            return selector;
        },
        getActive: function () {
            var filters = [];

            _.each(self.filter.get(), function (filter, key) {
                if (filter.value)
                    filters.push({
                        title: filter.title,
                        operator: (filter.operator && filter.operator[0]) ? filter.operator[0] : 'match',
                        value: filter.value,
                        key: key
                    });
            });

            return filters;
        },
        isActive: function (field, value, operator) {
            var filters = self.filter.get();

            if (_.has(filters, field)) {
                var check = filters[field];

                if (!check.value || check.value != value) {
                    return false;
                }

                if (check.operator && check.operator[0]) {
                    if (check.operator[0] != operator) {
                        return false;
                    }
                }

                return true;
            }
            return false;
        },
        run: function () {
            _query.selector = this.getSelector();
            self.query.set(_query);
            self.pager.moveTo(1);
        },
        clear: function (key, triggerUpdate) {
            triggerUpdate = _.isUndefined(triggerUpdate) ? true : triggerUpdate;

            if (key
                && _filters[key]
                && _filters[key].value) {
                delete _filters[key].value;
                _filters[key].active = false;
            }

            if (triggerUpdate) {
                this.run();
            }

            _deps.filter.changed();
        }
    };

    /**
     * [search description]
     * @type {Object}
     */
    self.search = {
        criteria: "",
        fields: [],
        required: [],
        init: function () {
            this.setFields();
        },
        getFields: function (full) {
            _deps.search.depend();

            full = _.isUndefined(full) ? false : full;

            if (full) {
                return _.union(this.fields, this.required);
            } else {
                return this.fields;

            }
        },
        setFields: function () {
            var activeSearch = [];
            var requiredSearch = [];

            _.each(_filters, function (field, key) {
                if (field.searchable
                    && field.searchable === 'optional') {
                    activeSearch.push({
                        field: key,
                        title: field.title,
                        active: false
                    });
                }

                if (field.searchable
                    && field.searchable === 'required') {
                    requiredSearch.push({
                        field: key,
                        title: field.title,
                        active: true
                    });
                }
            });

            this.fields = activeSearch;
            this.required = requiredSearch;
        },
        setField: function (key) {
            var _this = this;
            _.each(this.fields, function (field, idx) {
                if (_this.fields[idx].field === key
                    && _filters[field.field]
                    && _filters[field.field].searchable !== 'required') {
                    _this.fields[idx].active = (_this.fields[idx].active !== true);
                }

            });

            _deps.search.changed();
        },
        setCriteria: function (value, triggerUpdate) {

            triggerUpdate = triggerUpdate || false;

            var activeFields = this.getFields(true);

            if (value) {
                this.criteria = value;
                _.each(activeFields, function (field, key) {
                    if (field.active) {
                        self.filter.set(field.field, {
                            value: value
                        });
                    }
                });

                if (triggerUpdate) {
                    this.run();
                }
            }
        },
        getCriteria: function () {
            return this.criteria;
        },
        run: function () {
            self.pager.moveTo(1);
        },
        clear: function () {
            this.criteria = '';
            self.filter.clear();
        }
    };

    /**
     * [query description]
     * @type {Object}
     */
    self.query = {
        get: function () {
            _deps.query.depend();
            return EJSON.parse(_EJSONQuery);
        },
        set: function (query) {
            _EJSONQuery = EJSON.stringify(query);
            _deps.query.changed();
        },
        updateResults: function () {
            _query.force = new Date().getTime();
            this.set(_query);
        },
        getResults: function () {
            var temporaryQuery = EJSON.clone(_query);
            temporaryQuery.options = _.omit(temporaryQuery.options, 'skip', 'limit');

            // If we only want results fed from the FilterCollections publish, modify the selector
            if (_useFilterDataOnly) {
                temporaryQuery.selector.__filter = _subscriptionResultsId;
            }

            if (_.isFunction(_callbacks.beforeResults)) {
                temporaryQuery = _callbacks.beforeResults(temporaryQuery) || temporaryQuery;
            }

            var cursor = self._collection.find(temporaryQuery.selector, temporaryQuery.options);

            if (_.isFunction(_callbacks.afterResults)) {
                cursor = _callbacks.afterResults(cursor) || cursor;
            }

            return cursor;
        }
    };

    /**
     * For integration with e.g. Iron Router
     */

    self.ready = function ready() {
        _autorun();
        _deps.initial_ready.depend();
        return _initial_ready;
    };

    self.stop = function stop() {
        if (_autorun_handle !== undefined) {
            _autorun_handle.stop();
            _autorun_handle = undefined;
        }
        if (_subs.results.stop !== undefined) {
            _subs.results.stop();
            _subs.results = {}
        }
        if (_subs.count.stop !== undefined) {
            _subs.count.stop();
            _subs.count = {}
        }
    };

    /**
     * Template extensions
     */

    if (Template[_template]) {
        Template[_template].created = function () {
            _autorun();

            if (_.isFunction(_callbacks.templateCreated)) {
                _callbacks.templateCreated(this);
            }
        };

        Template[_template].rendered = function () {
            if (_.isFunction(_callbacks.templateRendered)) {
                _callbacks.templateRendered(this);
            }
        };

        /** Template cleanup. **/
        Template[_template].destroyed = function () {
            _subs.results.stop();
            _subs.count.stop();

            if (_.isFunction(_callbacks.templateDestroyed)) {
                _callbacks.templateDestroyed(this);
            }
        };

        Template[_template].helpers({
            fcResults: function () {
                return self.query.getResults();
            },
            fcSort: function () {
                return self.sort.get();
            },
            fcPager: function () {
                return self.pager.get();
            },
            fcFilter: function () {
                return self.filter.get();
            },
            fcFilterActive: function () {
                return self.filter.getActive();
            },
            fcFilterSearchable: function () {
                return {
                    available: self.search.getFields(),
                    criteria: self.search.getCriteria()
                };
            },
            fcFilterObj: function () {
                return self.filter;
            },
            fcPagerObj: function () {
                return self.pager;
            }
        });

        /** Template events. **/
        Template[_template].events({
            /** Filters **/
            'click .fc-filter': function (event) {
                event.preventDefault();

                var field = event.currentTarget.getAttribute('data-fc-filter-field') || false;
                var value = event.currentTarget.getAttribute('data-fc-filter-value') || false;
                var operator = event.currentTarget.getAttribute('data-fc-filter-operator') || false;
                var options = event.currentTarget.getAttribute('data-fc-filter-options') || false;
                var sort = event.currentTarget.getAttribute('data-fc-filter-sort') || false;

                var filter = {};

                if (field && value) {
                    filter['value'] = value;
                }

                if (operator) {
                    filter['operator'] = [operator, options];
                }

                if (sort) {
                    filter['sort'] = sort;
                }

                self.filter.set(field, filter);
            },
            'click .fc-filter-clear': function (event) {
                event.preventDefault();

                if (self.filter.getActive().length === 1) {
                    self.search.clear();
                }

                if (_filters[this.key]) {
                    self.filter.clear(this.key);
                }
            },
            'click .fc-filter-reset': function (event) {
                event.preventDefault();

                if (self.filter.getActive().length) {
                    self.search.clear();
                    self.filter.clear();
                }
            },

            /** Search **/
            'click .fc-search-trigger': function (event, template) {
                event.preventDefault();

                var target = event.currentTarget.getAttribute('data-fc-search-trigger');
                var value = template.find('[data-fc-search-target="' + target + '"]').value || '';
                self.search.setCriteria(value, true);
            },
            'click .fc-search-fields': function (event, template) {
                event.preventDefault();
                self.search.setField(this.field);
            },
            'click .fc-search-clear': function (event, template) {
                event.preventDefault();
                self.search.clear();
            },

            /** Pager **/
            'change .fc-pager-options': function (event) {
                event.preventDefault();
                var itemsPerPage = parseInt(event.target.value, 10) || _pager.itemsPerPage;
                self.pager.setItemsPerPage(itemsPerPage);
                self.pager.setCurrentPage(1, true);
            },
            'click .fc-pager-option': function (event) {
                event.preventDefault();
                var itemsPerPage = parseInt(event.currentTarget.getAttribute('data-fc-pager-page'), 10) || _pager.itemsPerPage;
                self.pager.setItemsPerPage(itemsPerPage);
                self.pager.setCurrentPage(1, true);
            },
            'click .fc-pager-page': function (event) {
                event.preventDefault();
                var page = parseInt(event.currentTarget.getAttribute('data-fc-pager-page'), 10) || _pager.currentPage;
                self.pager.moveTo(page);
            },
            'click .fc-pager-first': function (event) {
                event.preventDefault();
                self.pager.moveFirst();
            },
            'click .fc-pager-previous': function (event) {
                event.preventDefault();
                self.pager.movePrevious();
            },
            'click .fc-pager-next': function (event) {
                event.preventDefault();
                self.pager.moveNext();
            },
            'click .fc-pager-last': function (event) {
                event.preventDefault();
                self.pager.moveLast();
            },

            /** Sort **/
            'click .fc-sort': function (event, template) {
                event.preventDefault();
                var field = event.currentTarget.getAttribute('data-fc-sort');
                self.sort.set(field, null, true);
            },
            'click .fc-sort-clear': function (event, template) {
                event.preventDefault();
                self.sort.clear();
            }
        });
    } else {
        _autorun();
    }
};
