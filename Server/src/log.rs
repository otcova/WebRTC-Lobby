#![allow(unused_macros, unused_imports)]

/// For normal and correct user actions
macro_rules! user_action {
    ($($x:tt)*) => {
        // println!("[USER] {}", format!($($x)*));
    }
}

/// For Thing that should not happend if the user is well implemented
macro_rules! user_error {
    ($($x:tt)*) => { 
        println!("[USER-ERROR] {}", format!($($x)*));
    }
}

/// Internal server errors
macro_rules! error {
    ($($x:tt)*) => { 
        println!("[ERROR] {}", format!($($x)*));
    }
}

pub(crate) use user_action;
pub(crate) use user_error;
pub(crate) use error;
