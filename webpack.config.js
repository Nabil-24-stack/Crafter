const HtmlWebpackPlugin = require('html-webpack-plugin');
const HtmlInlineScriptPlugin = require('html-inline-script-webpack-plugin');
const path = require('path');

module.exports = (env, argv) => ({
  mode: argv.mode === 'production' ? 'production' : 'development',

  // This is necessary because Figma's 'eval' works differently than normal eval
  devtool: argv.mode === 'production' ? false : 'inline-source-map',

  entry: {
    code: './src/code.ts', // Main plugin code
    ui: './src/ui.tsx', // UI code
  },

  module: {
    rules: [
      // TypeScript + Babel loader (for ES5 compatibility)
      {
        test: /\.tsx?$/,
        use: [
          {
            loader: 'babel-loader',
            options: {
              presets: [
                ['@babel/preset-env', {
                  targets: {
                    // Figma plugin sandbox is ES5-like
                    ie: '11'
                  },
                  modules: false
                }]
              ]
            }
          },
          'ts-loader'
        ],
        exclude: /node_modules/,
      },
      // Babel loader for node_modules (transpile dependencies)
      {
        test: /\.js$/,
        include: /node_modules\/(node-html-parser|css-tree)/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/preset-env', {
                targets: {
                  ie: '11'
                }
              }]
            ]
          }
        }
      },
      // CSS loader
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
      // Image loader - convert to base64 data URL
      {
        test: /\.(png|jpg|jpeg|gif|svg)$/,
        type: 'asset/inline',
      },
    ],
  },

  resolve: {
    extensions: ['.tsx', '.ts', '.jsx', '.js'],
  },

  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, 'dist'),
    clean: true, // Clean the output directory before emit
  },

  plugins: [
    // Generate HTML file for the UI
    new HtmlWebpackPlugin({
      template: './src/ui.html',
      filename: 'ui.html',
      chunks: ['ui'],
      inject: 'body',
      scriptLoading: 'blocking',
      inlineSource: '.(js|css)$', // Inline all JS and CSS
    }),
    new HtmlInlineScriptPlugin(),
  ],
});
