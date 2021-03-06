/**
 * gulpfile.js
 * adapted from https://github.com/tmaximini/generator-ionic-gulp
 */
// jshint maxstatements:54
(function(){
    'use strict';

    var appName = 'app.core';

    var gulp = require('gulp');
    var plugins = require('gulp-load-plugins')();
    var del = require('del');
    var beep = require('beepbeep');
    var express = require('express');
    var path = require('path');
    var streamqueue = require('streamqueue');
    var runSequence = require('run-sequence');
    var ripple = require('ripple-emulator');
    var plato = require('plato');
    var paths = require('./gulp.config.json');

    // var gulpOpen = require('open');
    // var merge = require('merge-stream');
    // var wiredep = require('wiredep');

    /**
     * Parse arguments
     */
    var args = require('yargs')
        .alias('e', 'emulate')
        .alias('b', 'build')
        .alias('r', 'run')
        .alias('na', 'noAnalyze')
        // remove all debug messages (plugins.util.logs, alerts etc) from release build
        .alias('release', 'strip-debug')
        .default('build', false)
        .default('port', 8080)
        .default('strip-debug', false)
        .default('noAnalyze', false)
        .argv;

    var build = !!(args.build || args.emulate || args.run);
    var emulate = args.emulate;
    var run = args.run;
    var port = args.port;
    var stripDebug = !!args.stripDebug;
    var analyze = !args.noAnalyze;
    var targetDir = path.resolve(build ? paths.build : paths.buildDev);

    // if we just use emualate or run without specifying platform, we assume iOS
    // in this case the value returned from yargs would just be true
    if (emulate === true) {
        emulate = 'ios';
    }
    if (run === true) {
        run = 'ios';
    }

    // List the available gulp tasks
    gulp.task('help', plugins.taskListing);

    // clean target dir
    gulp.task('clean', function(done) {
        return del([targetDir], done);
    });

    // precompile .scss and concat with ionic.css
    gulp.task('styles', function() {
        var options = build ? {
            style: 'compressed'
        } : {
            style: 'expanded'
        };

        var sassStream = gulp.src(paths.sass)
            .pipe(plugins.sass(options))
            .on('error', function(err) {
                plugins.util.log('err: ', err);
                beep();
            });

        // build ionic css dynamically to support custom themes
        var ionicStream = gulp.src(paths.ionic.sass)
            .pipe(plugins.cached('ionic-styles'))
            .pipe(plugins.sass(options))
            // cache and remember ionic .scss in order to cut down re-compile time
            .pipe(plugins.remember('ionic-styles'))
            .on('error', function(err) {
                plugins.util.log('err: ', err);
                beep();
            });

        return streamqueue({
                objectMode: true
            }, ionicStream, sassStream)
            .pipe(plugins.autoprefixer('last 1 Chrome version', 'last 3 iOS versions', 'last 3 Android versions'))
            .pipe(plugins.concat('main.css'))
            .pipe(plugins.if(build, plugins.stripCssComments()))
            .pipe(plugins.if(build && !emulate, plugins.rev()))
            .pipe(gulp.dest(path.join(targetDir, 'content', 'styles')))
            .on('error', errorHandler);
    });

    /**
     * Lint the code, create coverage report, and a visualizer
     * @return {Stream}
     */
    gulp.task('analyze', function() {
        var jshint = analyzejshint(paths.js.concat('./gulpfile.js'));
        // var jscs = analyzejscs(paths.js.concat('./gulpfile.js'));

        startPlatoVisualizer();

        // return merge(jshint);
        return jshint;
    });

    // build templatecache, copy scripts.
    // if build: concat, minsafe, uglify and versionize
    gulp.task('scripts',  (analyze ? ['analyze'] : []), function() {
        var dest = path.join(targetDir, 'app');
        var minifyConfig = {
            collapseWhitespace: true,
            collapseBooleanAttributes: true,
            removeAttributeQuotes: true,
            removeComments: true
        };

        // prepare angular template cache from html templates
        // (remember to change appName var to desired module name)
        var templateStream = gulp
            .src(paths.htmltemplates)
            .pipe(plugins.angularTemplatecache('templates.js', {
                root: 'app/',
                module: appName,
                htmlmin: build && minifyConfig
            }));

        var scriptStream = gulp
            .src(paths.js.concat('templates.js'))
            .pipe(plugins.if(!build, plugins.changed(dest)));

        return streamqueue({
                objectMode: true
            }, scriptStream, templateStream)
            .pipe(plugins.ngAnnotate())
            .pipe(plugins.if(stripDebug, plugins.stripDebug()))
            .pipe(plugins.if(build, plugins.concat('app.js')))
            .pipe(plugins.if(build, plugins.uglify()))
            .pipe(plugins.if(build && !emulate, plugins.rev()))

        .pipe(gulp.dest(dest))

        .on('error', errorHandler);
    });

    // copy fonts
    gulp.task('fonts', function() {
        return gulp
            .src(paths.fonts)
            .pipe(gulp.dest(path.join(targetDir, 'content', 'fonts')))
            .on('error', errorHandler);
    });


    // generate iconfont
    gulp.task('iconfont', function() {
        return gulp.src('./src/client/content/icons/*.svg', {
                buffer: false
            })
            .pipe(plugins.iconfontCss({
                fontName: 'ownIconFont',
                path: './src/client/content/icons/own-icons-template.css',
                targetPath: '../styles/own-icons.css',
                fontPath: '../fonts/'
            }))
            .pipe(plugins.iconfont({
                fontName: 'ownIconFont'
            }))
            .pipe(gulp.dest(path.join(targetDir, 'content', 'fonts')))
            .on('error', errorHandler);
    });

    // copy images
    gulp.task('images', function() {
        return gulp.src(paths.images)
            // .pipe(plugins.cache(plugins.imagemin({
            //   optimizationLevel: 3
            // })))
            .pipe(gulp.dest(path.join(targetDir, 'content', 'images')))
            .on('error', errorHandler);
    });

    // concatenate and minify vendor sources
    gulp.task('vendor', function() {
        // var vendorFiles = wiredep().js;
        var vendorFiles = build ? paths.vendorjs : paths.vendorjsDev;

        return gulp.src(vendorFiles)
            .pipe(plugins.concat('vendor.js'))
            .pipe(plugins.if(build, plugins.uglify()))
            .pipe(plugins.if(build, plugins.rev()))

        .pipe(gulp.dest(path.join(targetDir, 'app')))

        .on('error', errorHandler);
    });

    // copy dynamic resource files
    gulp.task('office', function() {
        return gulp
            .src(paths.office)
            .pipe(gulp.dest(path.join(targetDir, 'office')))
            .on('error', errorHandler);
    });

    // copy data in for development
    gulp.task('data', function() {
        return gulp
            .src(paths.data)
            .pipe(gulp.dest(path.join(targetDir, 'data')))
            .on('error', errorHandler);
    });

    // inject the files in index.html
    gulp.task('index', ['scripts'], function() {
        // build has a '-versionnumber' suffix

        // injects 'src' into index.html at position 'tag'
        var _inject = function(src, tag) {
            return plugins.inject(src, {
                starttag: '<!-- inject:' + tag + ':{{ext}} -->',
                read: false,
                addRootSlash: false
            });
        };

        // get all our javascript sources
        // in development mode, it's better to add each file seperately.
        // it makes debugging easier.
        var _getAllScriptSources = function() {
            var scriptStream = gulp.src([
                'app/app*.js',
                '!app/vendor*.js',
                'app/**/*module*.js',
                'app/**/*constants*.js',
                'app/**/*.js'
            ], {
                cwd: targetDir
            });
            return streamqueue({
                objectMode: true
            }, scriptStream);
        };

        return gulp.src(paths.client + 'index.html')
            // inject css
            .pipe(_inject(gulp.src('content/styles/main*', {
                cwd: targetDir
            }), 'app-styles'))
            // inject vendor.js
            .pipe(_inject(gulp.src('app/vendor*.js', {
                cwd: targetDir
            }), 'vendor'))
            // inject app.js (build) or all js files indivually (dev)
            .pipe(plugins.if(build,
                _inject(gulp.src('app/app*.js', {
                    cwd: targetDir
                }), 'app'),
                _inject(_getAllScriptSources(), 'app')
            ))

        .pipe(gulp.dest(targetDir))
            .on('error', errorHandler);
    });

    // start local express server
    gulp.task('serve', function() {
        express()
            // .use(!build ? connectLr() : function(){})
            .use(express.static(targetDir))
            .listen(port);
        // gulpOpen('http://localhost:' + port + '/');
    });

    // ionic emulate wrapper
    gulp.task('ionic:emulate', plugins.shell.task([
        'ionic emulate ' + emulate + ' -p $PORT --consolelogs'
    ]));

    // ionic run wrapper
    gulp.task('ionic:run', plugins.shell.task([
        'ionic run ' + run
    ]));

    // ionic resources wrapper
    gulp.task('icon', plugins.shell.task([
        'ionic resources --icon'
    ]));
    gulp.task('splash', plugins.shell.task([
        'ionic resources --splash'
    ]));
    gulp.task('resources', plugins.shell.task([
        'ionic resources'
    ]));

    // select emulator device
    gulp.task('select', plugins.shell.task([
        './helpers/emulateios'
    ]));

    // ripple emulator
    gulp.task('ripple', ['scripts', 'styles', 'watchers'], function() {

        var options = {
            keepAlive: false,
            open: true,
            port: 8080
        };

        // Start the ripple server
        ripple.emulate.start(options);

        // gulpOpen('http://localhost:' + options.port + '?enableripple=true');
    });

    // start watchers
    gulp.task('watchers', function() {
        plugins.livereload.listen();
        gulp.watch(['./src/client/content/styles/**/*.scss', './src/office/*.scss'], ['styles']);
        gulp.watch('./src/client/content/fonts/**', ['fonts']);
        gulp.watch('./src/client/content/icons/**', ['iconfont']);
        gulp.watch('./src/client/content/images/**', ['images']);
        gulp.watch(paths.js, ['index']);
        gulp.watch('./gulp.config.json', ['load']);
        gulp.watch('./package.json', ['vendor']);
        gulp.watch('./plugins/**/*.js', ['vendor']);
        gulp.watch('./src/client/app/**/*.html', ['index']);
        gulp.watch('./src/client/index.html', ['index']);
        gulp.watch(paths.office, ['office']);
        gulp.watch('./src/server/data/*.json', ['data']);
        gulp.watch(targetDir + '/**')
            .on('change', plugins.livereload.changed)
            .on('error', errorHandler);
    });

    // no-op = empty function
    gulp.task('noop', function() {});

    gulp.task('load', function(done) {
        runSequence(
            'clean',
            'iconfont', [
                'fonts',
                'styles',
                'images',
                'vendor'
            ],
            'office',
            'data',
            'index',
            done);
    });

    // our main sequence, with some conditional jobs depending on params
    gulp.task('default', function(done) {

        runSequence(
            'load',
            build ? 'noop' : 'watchers',
            build ? 'noop' : 'serve',
            emulate ? ['ionic:emulate', 'watchers'] : 'noop',
            run ? 'ionic:run' : 'noop',
            done);
    });

    ////////////////

    // global error handler
    function errorHandler(error) {
        if (build) {
            throw error;
        }
        else {
            beep(2, 170);
            plugins.util.log(error);
        }
    }

    /**
     * Execute JSHint on given source files
     * @param  {Array} sources
     * @param  {String} overrideRcFile
     * @return {Stream}
     */
    function analyzejshint(sources, overrideRcFile) {
        var jshintrcFile = overrideRcFile || './.jshintrc';
        return gulp
            .src(sources)
            .pipe(plugins.jshint(jshintrcFile))
            .pipe(plugins.jshint.reporter('jshint-stylish'))
            .on('error', errorHandler);
    }

    /**
     * Start Plato inspector and visualizer
     */
    function startPlatoVisualizer() {
        // plugins.util.log('Running Plato');

        var options = {
            title: 'Plato Inspections Report'
        };

        plato.inspect('./src/client/app/**/*.js', paths.platoDir, options, platoCompleted);

        function platoCompleted(report) {
            var overview = plato.getOverviewReport(report);
            plugins.util.log(overview.summary);
        }
    }
})();
