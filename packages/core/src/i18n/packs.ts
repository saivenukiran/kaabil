/**
 * Phrase packs for the eight further languages: Yes and No words and the numbers 1 to 5.
 * PLACEHOLDER DATA. These are not used by the dose logic yet and have not been reviewed
 * by native speakers. They exist so the language list and the data shape are in place.
 */
export interface PhrasePack {
  code: string;
  name: string;
  yes: string;
  no: string;
  numbers: string[];
  status: 'placeholder';
}

export const PHRASE_PACKS: PhrasePack[] = [
  { code: 'ta', name: 'Tamil', yes: 'ஆமாம்', no: 'இல்லை', numbers: ['ஒன்று', 'இரண்டு', 'மூன்று', 'நான்கு', 'ஐந்து'], status: 'placeholder' },
  { code: 'kn', name: 'Kannada', yes: 'ಹೌದು', no: 'ಇಲ್ಲ', numbers: ['ಒಂದು', 'ಎರಡು', 'ಮೂರು', 'ನಾಲ್ಕು', 'ಐದು'], status: 'placeholder' },
  { code: 'ml', name: 'Malayalam', yes: 'അതെ', no: 'ഇല്ല', numbers: ['ഒന്ന്', 'രണ്ട്', 'മൂന്ന്', 'നാല്', 'അഞ്ച്'], status: 'placeholder' },
  { code: 'mr', name: 'Marathi', yes: 'हो', no: 'नाही', numbers: ['एक', 'दोन', 'तीन', 'चार', 'पाच'], status: 'placeholder' },
  { code: 'bn', name: 'Bengali', yes: 'হ্যাঁ', no: 'না', numbers: ['এক', 'দুই', 'তিন', 'চার', 'পাঁচ'], status: 'placeholder' },
  { code: 'gu', name: 'Gujarati', yes: 'હા', no: 'ના', numbers: ['એક', 'બે', 'ત્રણ', 'ચાર', 'પાંચ'], status: 'placeholder' },
  { code: 'pa', name: 'Punjabi', yes: 'ਹਾਂ', no: 'ਨਹੀਂ', numbers: ['ਇੱਕ', 'ਦੋ', 'ਤਿੰਨ', 'ਚਾਰ', 'ਪੰਜ'], status: 'placeholder' },
  { code: 'or', name: 'Odia', yes: 'ହଁ', no: 'ନା', numbers: ['ଏକ', 'ଦୁଇ', 'ତିନି', 'ଚାରି', 'ପାଞ୍ଚ'], status: 'placeholder' },
];
