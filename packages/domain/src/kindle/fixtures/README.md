# Kindle notebook fixtures

Hand-made pages in the shape of Amazon's Kindle notebook
(`read.amazon.com/notebook`), for the parser's tests and the host's fake
Amazon (#508). The element ids and classes are the ones open-source notebook
readers key on; the books are public domain and the highlights and notes are
invented. No real page, account or cookie went into them.

**They have not yet been checked against a real notebook page.** Before Kindle
sync is turned on for anyone, save a real page, scrub it (no names, ids,
tokens or cookies), and compare: where Amazon's markup differs, fix the
fixture and the parser together.

| File                      | What it stands for                                         |
| ------------------------- | ---------------------------------------------------------- |
| `library.html`            | The library: three books, one with no author shown         |
| `library-empty.html`      | A signed-in account with no highlights yet                 |
| `annotations-page-1.html` | A book's first page of annotations, with a next-page token |
| `annotations-page-2.html` | The same book's last page                                  |
| `sign-in.html`            | Amazon's sign-in page, as an expired session is shown      |
| `unrecognised.html`       | A page of some other shape, as after Amazon redesigns it   |
