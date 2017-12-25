# Contributing to macaca-ios

We love pull requests from everyone.

Fork, then clone the repo:

    git clone git@github.com:your-username/macaca-ios.git

Set up your machine:

    npm i

Then make your change and make sure the tests pass:

    npm run test

Push to your fork and [submit a pull request][pr].

[pr]: https://github.com/macacajs/macaca-ios/compare/

At this point you're waiting on us. We like to at least comment on pull requests
within three business days (and, typically, one business day). We may suggest
some changes or improvements or alternatives.

Some things that will increase the chance that your pull request is accepted:

## Link Global To Local

``` bash
$ npm link
# check linked success
$ cd $(npm root -g)
$ ls -l
# now macaca-ios in global is linked to your local
```
