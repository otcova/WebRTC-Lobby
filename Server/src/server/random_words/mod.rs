mod english_words;

use english_words::WORDS;

pub fn random_word() -> &'static str {
    WORDS[rand::random::<usize>() % WORDS.len()]
}
